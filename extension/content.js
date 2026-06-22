let lastCaption = "";
let timeout = null;

function sendToBackend(text) {
  fetch("http://localhost:5000/caption", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text })
  })
    .then(res => res.json())
    .then(data => console.log("Backend response:", data))
    .catch(err => console.error("Error:", err));
}

setInterval(() => {
  const captions = document.querySelectorAll("div.ygicle.VbkSUe");

  captions.forEach(caption => {
    const text = caption.innerText.trim();

    if (!text) return;

    // If caption changed
    if (text !== lastCaption) {
      lastCaption = text;

      // Clear previous timer
      if (timeout) clearTimeout(timeout);

      // Wait 2 seconds before sending
      timeout = setTimeout(() => {
        console.log("Final Caption detected:", lastCaption);
        sendToBackend(lastCaption);
      }, 2000);
    }
  });

}, 500);