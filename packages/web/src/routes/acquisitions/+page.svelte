<script lang="ts">
  // The detail pane's empty state: with no acquisition selected, the master list is the whole
  // view — beside this on a wide screen, above it on a narrow one (this index route is the one
  // place the panes still stack). Selecting a row navigates to /acquisitions/[id], whose page
  // replaces this placeholder in the detail pane and, below the collapse breakpoint, hides the
  // queue so the detail stands alone.
</script>

<h1>Acquisitions</h1>
<p data-testid="detail-empty">
  Select an acquisition from the queue to see its progress, history, and actions.
</p>
