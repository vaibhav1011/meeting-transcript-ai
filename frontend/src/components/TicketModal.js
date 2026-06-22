export default function TicketModal({ ticket, onClose }) {
  if (!ticket) return null

  return (
    <div className="fixed inset-0 bg-black/40 flex justify-center items-center z-50">
      <div className="bg-white w-[700px] max-h-[85vh] overflow-y-auto rounded-3xl p-8 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-6 right-6 text-gray-400 hover:text-gray-600"
        >
          ✕
        </button>

        <div className="flex gap-3 mb-4">
          <span className="text-sm text-gray-500">{ticket.id}</span>
          <span className="bg-orange-100 text-orange-600 px-3 py-1 rounded-full text-xs">
            {ticket.priority}
          </span>
          <span className="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full text-xs">
            {ticket.status}
          </span>
        </div>

        <h2 className="text-3xl font-bold mb-4">{ticket.title}</h2>

        <p className="text-gray-600 mb-6">{ticket.description}</p>

        <div className="grid grid-cols-2 gap-6 bg-gray-50 p-6 rounded-2xl mb-6">
          <div>
            <p className="text-sm text-gray-400">Category</p>
            <p className="font-medium">{ticket.category}</p>
          </div>
          <div>
            <p className="text-sm text-gray-400">Created Date</p>
            <p className="font-medium">{ticket.createdDate}</p>
          </div>
        </div>

        <div>
          <h4 className="font-semibold mb-3">Activity Timeline</h4>
          <ul className="space-y-3 text-sm text-gray-600">
            <li>Ticket Created</li>
            <li>Status Updated</li>
          </ul>
        </div>
      </div>
    </div>
  )
}