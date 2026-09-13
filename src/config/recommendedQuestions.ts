// Canned demo prompts shown as clickable suggestions on the manager chat
// page (both dev and prod) so a presenter doesn't have to type them live.
// The first is shown before any message is sent; the rest appear once the
// first response comes back. See ManagerChat.tsx.
export const RECOMMENDED_QUESTIONS = [
  'How many lapsed customers does store S004 have?',
  "Show me Gold tier customers at S004 who haven't visited in 30 days. I want to reach out to them personally.",
  "Send a £100 voucher to the 10 customers who haven't visited in 60 days at store S004.",
] as const
