# RSS subscription entry

Problem: Subscribe opened machine-readable XML with up to 50 full event bodies.
Visitors had no explanation or action that completed setup in a feed reader.

Three options were considered:

1. Rename the link to RSS. This names the destination but leaves reader setup
   unexplained and still opens raw XML as the primary action.
2. Open a subscription dialog. It gives context in place, but introduces another
   overlay inside mobile navigation and makes instructions less shareable.
3. Add a dedicated subscription page. Selected: a stable, accessible destination
   with a provider chooser, selectable URL, copy feedback, and setup instructions.
   The risk of excess copy is addressed by putting the feed choice and copy action
   first, with secondary instructions beside it on desktop and below on mobile.

The page uses the existing forest palette and type system. Human-facing Subscribe,
Follow the feed, and footer links lead to it. Raw XML is explicitly labeled in an
optional disclosure. Existing feed URLs and head autodiscovery remain unchanged.
Copying a URL is never described as a completed subscription. Clipboard failures
select the URL for manual copying; changing providers invalidates stale feedback.

The new page reads no database. Its exact path is allowed through middleware and
the static-rendering guard; database-backed routes retain their existing policy.
The user explicitly authorized fixing and deploying this UX on September 11, 2026.
