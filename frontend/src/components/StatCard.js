export default function StatCard({ label, value, color, border }) {
  return (
    <div
      className={`rounded-2xl bg-white p-6 shadow-sm border ${
        border || "border-gray-200"
      } w-full`}
    >
      <p className="text-sm text-gray-500 mb-2">{label}</p>
      <h2 className={`text-3xl font-bold ${color || "text-gray-900"}`}>
        {value}
      </h2>
    </div>
  )
}