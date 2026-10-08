/** Starter content for new runbooks (seeded into the collaborative doc on first open). */
export const RUNBOOK_TEMPLATE = `
<div data-callout="warning"><p><strong>Before you start:</strong> describe prerequisites, impact and maintenance window here.</p></div>
<h2>Steps</h2>
<ul data-type="taskList" data-variant="steps">
  <li data-type="taskItem" data-checked="false"><p>First step</p></li>
  <li data-type="taskItem" data-checked="false"><p>Second step</p></li>
  <li data-type="taskItem" data-checked="false"><p>Verify the result</p></li>
</ul>
<pre><code class="language-powershell"># Command for this runbook
Get-Service | Where-Object Status -eq 'Running'</code></pre>
<h2>Rollback</h2>
<p>How to undo the change if something goes wrong.</p>
`.trim();

/** Starter content for knowledge-base articles. */
export const KB_TEMPLATE = `
<div data-callout="info"><p><strong>Applies to:</strong> product and version.</p></div>
<h2>Symptoms</h2>
<p>What the user sees.</p>
<h2>Cause</h2>
<p>Why it happens.</p>
<h2>Resolution</h2>
<ul data-type="taskList" data-variant="steps">
  <li data-type="taskItem" data-checked="false"><p>Step one</p></li>
</ul>
`.trim();
