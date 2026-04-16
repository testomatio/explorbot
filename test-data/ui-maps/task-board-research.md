## Navigation

> Container: `.sidebar-nav`

| Element | Type | ARIA | CSS | Coordinates |
|------|------|------|------|------|
| 'Dashboard' | link | { role: 'link', text: 'Dashboard' } | '.sidebar-nav a[href="/dashboard"]' | (32, 88) |
| 'Task Board' | link | { role: 'link', text: 'Task Board' } | '.sidebar-nav a[href="/tasks/board"]' | (32, 128) |
| 'Projects' | link | { role: 'link', text: 'Projects' } | '.sidebar-nav a[href="/projects"]' | (32, 168) |
| 'Reports' | link | { role: 'link', text: 'Reports' } | '.sidebar-nav a[href="/reports"]' | (32, 208) |
| 'Settings' | link | { role: 'link', text: 'Settings' } | '.sidebar-nav a[href="/settings"]' | (32, 248) |

## Content

> Container: `.board-header`
> **Focused**

| Element | Type | ARIA | CSS | Coordinates |
|------|------|------|------|------|
| 'Create Task' | button | { role: 'button', text: 'Create Task' } | '.board-header button.primary' | (240, 30) |
| 'Search tasks' | textbox | { role: 'textbox', text: 'Search tasks' } | '.board-header input[type="search"]' | (420, 30) |
| 'Filter by assignee' | combobox | { role: 'combobox', text: 'Assignee' } | '.board-header select.assignee-filter' | (620, 30) |
| 'Sort by' | combobox | { role: 'combobox', text: 'Sort by' } | '.board-header select.sort' | (780, 30) |
| 'Board view' | button | { role: 'button', text: 'Board' } | '.board-header button.view-board' | (920, 30) |
| 'List view' | button | { role: 'button', text: 'List' } | '.board-header button.view-list' | (980, 30) |

## List: Task Columns

> Container: `.board-columns`

Three columns: To Do, In Progress, Done. Each column contains task cards with title, assignee avatar, priority badge, and due date. Cards are draggable between columns.

| Element | Type | ARIA | CSS | Coordinates |
|------|------|------|------|------|
| 'To Do column header' | heading | { role: 'heading', text: 'To Do' } | '.board-columns .column-todo h2' | (200, 100) |
| 'In Progress column header' | heading | { role: 'heading', text: 'In Progress' } | '.board-columns .column-progress h2' | (600, 100) |
| 'Done column header' | heading | { role: 'heading', text: 'Done' } | '.board-columns .column-done h2' | (1000, 100) |
| 'Add task to column' | button | { role: 'button', text: 'Add' } | '.board-columns button.add-task' | (200, 140) |
