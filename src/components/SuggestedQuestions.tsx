export default function SuggestedQuestions({
  questions,
  onSelect,
  disabled,
}: {
  questions: readonly string[]
  onSelect: (question: string) => void
  disabled?: boolean
}) {
  if (questions.length === 0) return null

  return (
    <div className="flex flex-col gap-2 px-4 py-2">
      <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
        Suggested
      </span>
      {questions.map((question) => (
        <button
          key={question}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(question)}
          className="rounded-card border border-border bg-white px-3 py-2 text-left text-sm text-text-primary shadow-sm transition hover:border-text-secondary hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {question}
        </button>
      ))}
    </div>
  )
}
