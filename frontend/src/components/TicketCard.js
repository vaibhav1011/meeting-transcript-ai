export default function TicketCard({ ticket, onClick }) {
  const priorityColor =
    ticket.priority === "Urgent"
      ? "bg-red-100 text-red-600"
      : ticket.priority === "High"
      ? "bg-orange-100 text-orange-600"
      : "bg-blue-100 text-blue-600"

  const statusColor =
    ticket.status === "Open"
      ? "bg-blue-100 text-blue-600"
      : ticket.status === "In Progress"
      ? "bg-yellow-100 text-yellow-700"
      : "bg-green-100 text-green-600"

  return (
    <div
      onClick={onClick}
      className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 hover:shadow-md transition cursor-pointer"
    >
      <div className="flex justify-between items-center mb-3">
        <span className="text-sm text-gray-500">{ticket.id}</span>
        <span className={`text-xs px-3 py-1 rounded-full ${priorityColor}`}>
          {ticket.priority}
        </span>
      </div>

      <h3 className="text-lg font-semibold text-gray-900 mb-2">
        {ticket.title}
      </h3>

      <p className="text-sm text-gray-500 mb-4 line-clamp-2">
        {ticket.description}
      </p>

      <div className="flex justify-between items-center text-sm">
        <div className="flex gap-2">
          <span className={`px-3 py-1 rounded-full ${statusColor}`}>
            {ticket.status}
          </span>
          <span className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full">
            {ticket.category}
          </span>
        </div>
        <span className="text-gray-400">{ticket.time}</span>
      </div>
    </div>
  )
}