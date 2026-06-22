import base64
import logging
import os
import tempfile
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np
import torch
import whisperx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from pyannote.audio import Audio, Inference, Pipeline


DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
COMPUTE_TYPE = os.getenv("WHISPERX_COMPUTE_TYPE", "float16" if DEVICE == "cuda" else "int8")
HF_TOKEN = os.getenv("HF_TOKEN", "")
WHISPERX_MODEL = os.getenv("WHISPERX_MODEL", "large-v3")
WHISPERX_BATCH_SIZE = int(os.getenv("WHISPERX_BATCH_SIZE", "8"))

app = FastAPI(title="meeting-ml-service")
logger = logging.getLogger("meeting-ml-service")


class WordOut(BaseModel):
    word: str
    start: float
    end: float
    score: Optional[float] = None


class SegmentOut(BaseModel):
    speaker: str
    text: str
    start_time: float
    end_time: float
    confidence: Optional[float] = None
    words: List[WordOut] = Field(default_factory=list)


class ChunkRequest(BaseModel):
    meeting_id: str
    chunk_id: str
    sequence: int
    language: Optional[str] = "en"
    mime_type: str = "audio/wav"
    sample_rate: int = 16000
    audio_base64: str


class ChunkResponse(BaseModel):
    meeting_id: str
    chunk_id: str
    sequence: int
    segments: List[SegmentOut]


@dataclass
class SpeakerProfile:
    label: str
    embedding: np.ndarray


@dataclass
class MeetingState:
    next_speaker_index: int = 1
    speakers: List[SpeakerProfile] = field(default_factory=list)


meeting_states: Dict[str, MeetingState] = {}
audio_reader = Audio(sample_rate=16000, mono="downmix")


def get_models():
    if not hasattr(get_models, "whisper_model"):
        get_models.whisper_model = whisperx.load_model(
            WHISPERX_MODEL,
            DEVICE,
            compute_type=COMPUTE_TYPE,
            language="en"
        )
        get_models.align_models = {}
        get_models.diarization = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=HF_TOKEN or None
        )
        if get_models.diarization is None:
            raise RuntimeError(
                "Could not load pyannote/speaker-diarization-3.1. "
                "Check HF_TOKEN and accept the model terms on Hugging Face."
            )
        get_models.embedding = Inference(
            "pyannote/embedding",
            window="whole",
            use_auth_token=HF_TOKEN or None
        )
    return (
        get_models.whisper_model,
        get_models.align_models,
        get_models.diarization,
        get_models.embedding
    )


def get_align_model(language_code: str):
    _whisper_model, align_models, _diarization, _embedding = get_models()
    if language_code not in align_models:
        align_models[language_code] = whisperx.load_align_model(language_code=language_code, device=DEVICE)
    return align_models[language_code]


def cosine_similarity(left: np.ndarray, right: np.ndarray) -> float:
    denominator = np.linalg.norm(left) * np.linalg.norm(right)
    if denominator == 0:
        return -1.0
    return float(np.dot(left, right) / denominator)


def map_global_speaker(meeting_id: str, speaker_embedding: np.ndarray) -> str:
    state = meeting_states.setdefault(meeting_id, MeetingState())
    best_label = None
    best_score = -1.0

    for profile in state.speakers:
        score = cosine_similarity(profile.embedding, speaker_embedding)
        if score > best_score:
            best_score = score
            best_label = profile.label

    if best_label is not None and best_score >= 0.72:
        for profile in state.speakers:
            if profile.label == best_label:
                profile.embedding = (profile.embedding + speaker_embedding) / 2
                return best_label

    label = f"Speaker {state.next_speaker_index}"
    state.next_speaker_index += 1
    state.speakers.append(SpeakerProfile(label=label, embedding=speaker_embedding))
    return label


def suffix_for_mime_type(mime_type: str) -> str:
    normalized = (mime_type or "").split(";")[0].strip().lower()
    return {
        "audio/wav": ".wav",
        "audio/wave": ".wav",
        "audio/x-wav": ".wav",
        "audio/webm": ".webm",
        "audio/ogg": ".ogg",
        "audio/opus": ".opus",
        "audio/mpeg": ".mp3",
        "audio/mp4": ".m4a",
        "audio/x-m4a": ".m4a",
    }.get(normalized, ".audio")


def decode_audio_to_tempfile(audio_base64: str, mime_type: str) -> str:
    raw_bytes = base64.b64decode(audio_base64)
    with tempfile.NamedTemporaryFile(suffix=suffix_for_mime_type(mime_type), delete=False) as handle:
        handle.write(raw_bytes)
        return handle.name


def diarization_turns_to_dicts(diarization_result):
    items = []
    for turn, _track, speaker in diarization_result.itertracks(yield_label=True):
        items.append(
            {
                "start": float(turn.start),
                "end": float(turn.end),
                "speaker": speaker
            }
        )
    return items


def collect_segment_embedding(audio_path: str, start_time: float, end_time: float, embedding_model) -> np.ndarray:
    waveform, sample_rate = audio_reader(audio_path)
    sample_start = max(0, int(start_time * sample_rate))
    sample_end = max(sample_start + 1, int(end_time * sample_rate))
    sliced = waveform[:, sample_start:sample_end]
    if sliced.shape[1] == 0:
        sliced = waveform
    return np.asarray(embedding_model({"waveform": sliced, "sample_rate": sample_rate})).reshape(-1)


def assign_global_labels(audio_path: str, diarization_segments: List[dict], meeting_id: str, embedding_model):
    label_map = {}
    for diarization_segment in diarization_segments:
        local_speaker = diarization_segment["speaker"]
        if local_speaker in label_map:
            continue
        embedding = collect_segment_embedding(
            audio_path,
            diarization_segment["start"],
            diarization_segment["end"],
            embedding_model
        )
        label_map[local_speaker] = map_global_speaker(meeting_id, embedding)
    return label_map


def transform_segments(aligned_result, speaker_labels):
    transformed = []
    for segment in aligned_result.get("segments", []):
        speaker = speaker_labels.get(segment.get("speaker"), segment.get("speaker", "Speaker 1"))
        words = []
        for word in segment.get("words", []):
            if word.get("word"):
                words.append(
                    WordOut(
                        word=word["word"],
                        start=float(word.get("start", segment["start"])),
                        end=float(word.get("end", segment["end"])),
                        score=float(word["score"]) if word.get("score") is not None else None
                    )
                )

        transformed.append(
            SegmentOut(
                speaker=speaker,
                text=segment.get("text", "").strip(),
                start_time=float(segment["start"]),
                end_time=float(segment["end"]),
                confidence=float(segment["avg_logprob"]) if segment.get("avg_logprob") is not None else None,
                words=words
            )
        )
    return [segment for segment in transformed if segment.text]


@app.get("/health")
def health():
    return {"ok": True, "device": DEVICE}


@app.post("/v1/transcribe-chunk", response_model=ChunkResponse)
def transcribe_chunk(body: ChunkRequest):
    if not HF_TOKEN:
        raise HTTPException(status_code=500, detail="HF_TOKEN is required for pyannote models")

    audio_path = decode_audio_to_tempfile(body.audio_base64, body.mime_type)

    try:
        whisper_model, _align_models, diarization_pipeline, embedding_model = get_models()
        audio_array = whisperx.load_audio(audio_path)
        transcription = whisper_model.transcribe(
            audio_array,
            batch_size=WHISPERX_BATCH_SIZE,
            language=body.language or "en"
        )
        align_model, align_metadata = get_align_model(transcription.get("language", body.language or "en"))
        aligned = whisperx.align(
            transcription["segments"],
            align_model,
            align_metadata,
            audio_array,
            DEVICE,
            return_char_alignments=False
        )
        diarization_result = diarization_pipeline(audio_path)
        diarization_segments = diarization_turns_to_dicts(diarization_result)
        labeled = whisperx.assign_word_speakers(diarization_segments, aligned)
        speaker_labels = assign_global_labels(audio_path, diarization_segments, body.meeting_id, embedding_model)
        segments = transform_segments(labeled, speaker_labels)

        return ChunkResponse(
            meeting_id=body.meeting_id,
            chunk_id=body.chunk_id,
            sequence=body.sequence,
            segments=segments
        )
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Failed to transcribe chunk %s for meeting %s", body.chunk_id, body.meeting_id)
        raise HTTPException(
            status_code=500,
            detail=f"{type(error).__name__}: {error}"
        ) from error
    finally:
        try:
            os.unlink(audio_path)
        except OSError:
            pass
