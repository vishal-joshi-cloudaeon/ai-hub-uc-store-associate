import { useState } from 'react'

type DenyModalProps = {
  onCancel: () => void
  onSubmit: (reason: string) => void
  submitting?: boolean
}

const MIN_LENGTH = 10

export default function DenyModal({ onCancel, onSubmit, submitting }: DenyModalProps) {
  const [reason, setReason] = useState('')
  const isValid = reason.trim().length >= MIN_LENGTH

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-md rounded-card bg-white p-6 shadow-lg">
        <h2 className="text-base font-semibold text-text-primary">Reason for denial</h2>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Please provide a reason for denying this request..."
          rows={4}
          className="mt-3 w-full resize-none rounded-card border border-border px-3 py-2 text-sm text-text-primary transition focus:border-brand-blue focus:outline-none"
        />
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-card border border-border px-4 py-2 text-sm font-medium text-text-secondary transition hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!isValid || submitting}
            onClick={() => onSubmit(reason.trim())}
            className="flex-1 rounded-card bg-brand-red px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit denial'}
          </button>
        </div>
      </div>
    </div>
  )
}
