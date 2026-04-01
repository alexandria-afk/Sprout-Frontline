# Mobile Design Guidelines — Sprout Field Ops

**Inspired by WHOOP's layout patterns. Light theme default, dark mode optional.**

---

## What We're Borrowing from WHOOP

Four specific patterns:

1. **Stacked metric cards at top of home screen** — glanceable KPIs in a 2x2 grid. Bold number, label, and one-line detail. Tappable for drill-down.
2. **Insight cards below metrics** — AI-generated insight and anomaly cards. Swipe right to dismiss. Only sourced from sidekick/AI, not from system events. (Not yet implemented — placeholder in code.)
3. **Card layering** — cards within cards. Outer card = section container (`surface-1`). Inner cards/rows = individual items (`surface-2`). Depth without borders.
4. **AI Sidekick FAB** — purple sparkle floating action button on every screen. Tapping opens a bottom sheet with suggestion chips and chat input. Persistent across all tabbed screens.

---

## Color Palette

### Light Theme (default)

| Token | Hex | Usage |
|---|---|---|
| `background` | `#F2F2F7` | App background, root level |
| `surface-1` | `#FFFFFF` | Primary cards, section containers |
| `surface-2` | `#F2F2F7` | Inner cards/rows within a card, input fields |
| `surface-3` | `#E5E5EA` | Pressed states, dividers, inactive elements |

### Dark Theme (optional, user toggle — not yet implemented)

| Token | Hex | Usage |
|---|---|---|
| `background` | `#111214` | App background |
| `surface-1` | `#1A1C1E` | Primary cards |
| `surface-2` | `#242628` | Inner cards/rows |
| `surface-3` | `#2E3032` | Pressed states, inputs |

### Brand

| Token | Hex | Usage |
|---|---|---|
| `sprout-green` | `#1D9E75` | Primary actions, active nav, positive indicators |
| `sprout-green-light` | `#E1F5EE` | Light green tint for backgrounds, selected states |
| `sprout-dark` | `#085041` | Dark green for emphasis text |
| `sprout-purple` | `#7C3AED` | Sidekick AI, accent highlights |

### Semantic

| Token | Hex | Usage |
|---|---|---|
| `critical` | `#FF3B30` | Critical priority, SLA breach, overdue |
| `high` | `#FF9500` | High priority, warnings |
| `medium` | `#FFD60A` | Medium priority, caution |
| `positive` | `#30D158` | Success, completed, on-track |
| `info` | `#0A84FF` | Informational, links, neutral data |

### Text (light theme)

| Token | Hex | Usage |
|---|---|---|
| `text-primary` | `#1C1C1E` | Headlines, metric numbers, primary content |
| `text-secondary` | `#8E8E93` | Subtext, labels, timestamps |
| `text-tertiary` | `#C7C7CC` | Placeholders, disabled text, inactive nav |
| `text-on-accent` | `#FFFFFF` | Text on sprout-green buttons |

---

## Typography

System fonts only (San Francisco / Roboto). Numbers are bold and large. Section labels are small ALL-CAPS.

| Style | Size | Weight | Transform | Usage |
|---|---|---|---|---|
| `metric-large` | 28px | Bold | Normal | Metric card numbers |
| `section-label` | 12px | Semibold | UPPERCASE | Section headers: "MY INBOX", "MY SHIFT" |
| `headline` | 20px | Semibold | Normal | Greeting, screen titles |
| `body` | 16px | Regular | Normal | Content, descriptions |
| `body-bold` | 16px | Semibold | Normal | Emphasized text, card titles |
| `caption` | 13px | Regular | Normal | Timestamps, metadata, detail lines |
| `caption-bold` | 13px | Semibold | Normal | Badges, status pills, filter pills |
| `nav-label` | 10px | Medium | Normal | Bottom nav labels |

---

## Home Screen — Implemented Layout

```
┌──────────────────────────────────────┐
│  Good afternoon, Maria          [👤] │  ← greeting + profile avatar (tap for logout)
│                                      │
│  ┌────────────┐ ┌────────────┐       │  ← 2x2 metric cards
│  │ 3          │ │ 5          │       │
│  │ Overdue    │ │ Open Issues│       │
│  │ of 12 tasks│ │ Needs attn │       │
│  └────────────┘ └────────────┘       │
│  ┌────────────┐ ┌────────────┐       │
│  │ 2          │ │ 4          │       │
│  │ Courses to │ │ Shifts This│       │
│  │ Complete   │ │ Week       │       │
│  └────────────┘ └────────────┘       │
│                                      │
│  ┌────────────────────────────────┐  │  ← MY INBOX (unified)
│  │  MY INBOX                   ↗ │  │
│  │  ┌────────────────────────┐   │  │
│  │  │ 📋 Opening Checklist   │   │  │    Top 5 items from:
│  │  │    Form · Overdue 3d   │   │  │    tasks, forms, issues,
│  │  └────────────────────────┘   │  │    courses, announcements
│  │  ┌────────────────────────┐   │  │
│  │  │ ⚠️ Fryer malfunction   │   │  │    Sorted: overdue first,
│  │  │    Issue · open        │   │  │    then by due date
│  │  └────────────────────────┘   │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │  ← MY SHIFT
│  │  MY SHIFT                   ↗ │  │
│  │  ┌────────────────────────┐   │  │
│  │  │ 🕐 9:00 AM – 5:00 PM  │   │  │
│  │  │    Main Branch · Active│   │  │
│  │  └────────────────────────┘   │  │
│  └────────────────────────────────┘  │
│                                      │
│  🏠    📋    ⚠️    📅    ···    [✦] │  ← bottom nav + Sidekick FAB
└──────────────────────────────────────┘
```

### Metric Cards (2x2 Grid)
- Two rows, two columns, 12px gap
- Each card: `surface-1` bg, 16px border radius, 16px padding
- Number: 28px bold, colored by semantic meaning
- Label: 13px semibold, `text-primary`
- Detail line: 12px, `text-secondary` (e.g. "of 12 total tasks")
- Tappable — navigates to relevant screen

### Unified Inbox
- Sources: tasks (not completed), form assignments (active), issues (open/in-progress), courses (not completed), announcements (unacknowledged)
- Shows top 5 items, sorted by overdue-first then by due date
- Each row has colored icon badge by type, title, and detail line
- "↗" arrow in header navigates to tasks list

### My Shift Section
- Shows today's shift or next upcoming
- Active shift shows green "ACTIVE" badge
- Tappable → shifts screen

---

## Bottom Navigation — Implemented

| Tab | Icon | Label | Destination |
|---|---|---|---|
| Home | `home` / `home_outlined` | Home | `/dashboard` |
| Tasks | `assignment` / `assignment_outlined` | Tasks | `/tasks` |
| Issues | `warning_amber` / `warning_amber_outlined` | Issues | `/issues` |
| Shifts | `calendar_today` / `calendar_today_outlined` | Shifts | `/shifts` |
| More | `menu` | More | Bottom sheet |

Active tab: `sprout-green` (`#1D9E75`). Inactive: `text-tertiary` (`#C7C7CC`). Selected icons use filled variants.

### More Menu (Bottom Sheet)
Opens from the "More" tab. Contains:
- Forms & Checklists
- Training
- Announcements
- Badges & Points

### Sidekick FAB
- Purple (`#7C3AED`) floating action button, bottom-right
- `auto_awesome` icon (sparkle), white
- Visible on ALL tabbed screens (lives in AppShell)
- Tap opens Sidekick bottom sheet (55–85% height)
- Sheet contains: header with purple icon + "Sidekick" label, suggestion chips, chat input

---

## Screen Inventory — Implemented

### Tabbed Screens (with bottom nav + Sidekick FAB)
| Route | Screen | Features |
|---|---|---|
| `/dashboard` | Home | Metric cards, inbox, shift section, profile avatar |
| `/tasks` | My Tasks | Filter pills (Pending/In Progress/Completed), task cards with priority bars |
| `/issues` | My Issues | Filter pills (Open/In Progress/Pending Vendor/Resolved/Verified Closed), issue cards, green FAB for report |
| `/shifts` | My Shifts | Two tabs (My Shifts / Open Shifts), clock in/out buttons on today's shifts |
| `/forms` | Forms & Checklists | Filter pills (To Do/Completed/All), overdue flagging |
| `/training` | My Training | Filter pills (In Progress/Assigned/All), enrollment status pills |
| `/announcements` | Announcements | Social media feed layout, photos, acknowledge button |
| `/badges` | Badges & Points | Two tabs (My Badges / Leaderboard), multiple leaderboard picker |

### Full-Screen Routes (no bottom nav, back button always present)
| Route | Screen | Features |
|---|---|---|
| `/forms/fill/:id` | Form Fill | All field types, conditional logic, save draft, submit |
| `/issues/report` | Report Issue | Title, description, AI classification, category dropdown, location, equipment, priority, photos |
| `/issues/:id` | Issue Detail | Photos, status update buttons, history, comment thread |
| `/tasks/:id` | Task Detail | Status update, message thread, metadata |
| `/training/:id` | Course Player | Slides (swipe), quiz, completion screen |

---

## Filter Pills Pattern

Used on: Tasks, Issues, Forms, Training, Leaderboards.

- Horizontally scrollable row, 48px height
- Each pill: 12px horizontal padding, 6px vertical, 20px border radius
- Active: semantic color at 15% opacity bg, 40% opacity border, bold text
- Inactive: `pageBg` bg, `border` color border, normal weight
- Shows count in parentheses: "Pending (5)"
- Tap to filter list below

---

## Announcements — Social Feed Layout

Cards in a vertical feed, similar to social media posts:
- **Header**: avatar circle (creator initial), creator name, time ago, unread dot
- **Title**: 16px semibold
- **Body**: full text, no truncation
- **Photos**: single image full-width or horizontal scroll gallery (200px wide thumbnails)
- **Acknowledge button**: green `ElevatedButton` for unacknowledged items, green "Acknowledged" chip when done
- Auto-marks as read on scroll into view

---

## Issue Reporting — AI-Assisted

1. Title + Description fields
2. "Analyze with AI" button appears after 10+ chars in description
3. AI suggestion card: purple border, shows priority/type/safety risk + reasoning
4. "Accept suggestion" fills fields; green "AI suggestion applied" confirmation
5. Category dropdown (from API), Where exactly (text), Which equipment (text)
6. Priority segmented button, Safety risk toggle
7. Photo picker (camera + gallery)
8. Submit bar at bottom

---

## Component Reference

### Buttons
- **Primary:** `sprout-green` bg, white text, 12px radius, 50px height, full width
- **Secondary:** `surface-2` bg, `text-primary` text, 12px radius, 50px height
- **Small:** `surface-2` bg, `sprout-green` text, 8px radius, 36px height
- **Destructive:** transparent bg, `critical` text

### Input Fields
- Background: `surface-2`, no borders (1px `sprout-green` on focus)
- Border radius: 12px
- Label above: `caption-bold`, `text-secondary`

### Status Pills
- Background: semantic color at 15% opacity
- Text: semantic color full opacity
- Radius: 6px, padding: 4px 8px, `caption-bold`

### Empty States
- Centered, icon 48px `text-tertiary`, title `text-secondary`, optional CTA

### Loading
- Skeleton screens on home, spinners on sub-screens

### Bottom Sheets
- `surface-1` bg, top radius 20px, drag handle, max 85% height

### Error Screens
- Always include back button in app bar to prevent users getting stuck
- Full-screen routes go back to their parent list

---

## Spacing

- Screen edge: 16px horizontal
- Between metric cards: 12px
- Between outer cards: 16px
- Between inner rows: 8px
- Card padding: 16px (outer), 12px (inner)
- Outer card radius: 16px
- Inner row radius: 10px
- Metric card radius: 16px

---

## Animation

- Insight card swipe-dismiss: slide right + fade out
- Bottom sheet: slide up
- AI chat expand: slide up from FAB tap
- Page transitions: horizontal slide
- Card press: scale 0.98, spring back
- No playful animations

---

## Accessibility

- Touch targets: 44x44px minimum
- Contrast: 4.5:1 minimum
- Support system font scaling
- Color + icon/text paired (never color alone)
- Swipe-to-dismiss cards also have dismiss button

---

## What NOT to Do

- No gradient backgrounds
- No drop shadows (surface color layering only — exception: Sidekick FAB has subtle shadow)
- No decorative illustrations
- No more than 2 font weights per screen
- No text below 12px
- No horizontal scroll for primary content (only metric cards and filter pills)
- No native pickers (use bottom sheets)
- No borders on cards (exception: filter pills have 1px border)
- Error screens must always have a back button — never trap the user
