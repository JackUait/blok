# Measured deltas to implement (from research/08)

Each item names the phase that owns it. Tick an item when its test-first commit lands on `db-parity`.

- [ ] P1: The no-value column on a select board is LAST. A new group added later goes after it.
- [ ] P1: The D7 prompt "Would you like to remove sorting?" (Remove / Don't remove) replaces Phase 0's sorted-drag gate.
  - Remove: delete the sorts, write the sorted order as positions, then place the row where it was dropped.
  - Dialog: 324 wide, 20px padding, 12px radius; enters with scale 0.97 → 1 and opacity, over 200ms ease.
- [ ] P1: Deleting an option asks "Are you sure you want to delete this option?".
  - The group's "⋯" menu gets: Edit groups, Hide aggregation, Hide group, Move to Trash (with the confirm "All pages inside this group will be moved to Trash."), and the 10 colors.
- [x] P1: Drag ghosts use opacity 0.4, with no rotation, scale or shadow. The drop line is 4px `rgba(35,131,226,0.43)` and fades over 200ms. There is no reflow animation on drop.
  - Today Blok uses rotate(2deg) scale(1.02), opacity 0.85 and a gap animation.
- [ ] P1: Side peek is half the viewport. It slides in with translateX over 200ms ease, and the content narrows over the same time.
  - Today the drawer animates its width to 45%.
- [ ] P1: Menus open with opacity 0→1 and scale 0.96→1 over 200ms ease, from the corner nearest the anchor.
- [ ] P1: Group collapse rotates only the caret (−90°, 200ms ease-out). Rows appear and disappear at once.
- [ ] P1: View tab switch: the background changes over 100ms ease-in-out, and the body swaps in one frame.
- [ ] P1: The table cell keyboard model from research/08 §"Cell keyboard model", exactly.
- [ ] P1: The calculation footer menu: None / Count › / Percent › / More options › (number) / Date › (date). Checkbox gets Checked/Unchecked. The label is 10px uppercase.
- [ ] P1: The column header menu items per type (research/08 table).
- [ ] P1: The row ⋮⋮ menu: Edit icon, Edit property ›, Open in ›, Comment, Copy link, Duplicate (⌘D), Move to, Move to Trash (Del). Footer: "Last edited by …".
- [ ] P1: The OPEN button on the title cell shows a side-peek icon before "OPEN".
- [ ] P1: The board card: 10px radius, a 3-layer shadow whose 1px ring takes the column hue, and a 15px/500 title. The column tint has a 10px bottom radius.
- [ ] P2: Number "Edit property": format (Number, Number with separators, Percent, 41 currencies), Decimal places, Show as Number/Bar/Ring.
- [ ] P3: The filter pill turns blue with a value. **Divergence**: an active filter pill is a "selected/active state" under Blok's law, so use gray.
- [ ] P3: Group settings per type (research/08 table). The select group sort is Manual/Alphabetical/Reverse. Date grouping offers Relative/Day/Week/Month/Year. Number grouping offers Unique/Range. Text grouping offers Exact/Alphabetical.
- [ ] P3: Conditional color: rule cards, "Page background", "Apply to: Entire row / property".
- [ ] P3: Load limit 10/25/50/100, board default 25. "Load more groups" when there are more than 10 groups.
- [ ] P3: Advanced filters: "Where … And/Or", "+ Add filter rule / Add filter group".
- [ ] P4: A new row in a filtered view opens in a peek, prefilled with what the filters allow (date "this week" → today).
- [ ] P4: Open pages in: Side peek (default for Board) / Center peek / Full page, with the descriptions measured in research/08.
- [ ] P1: Edit-mode right-click on a view tab opens the view menu, then core's block menu (ui.ts:700 contextmenu) replaces it. The view menu must win (verify0/3d).
- [ ] P1 (core): PopoverDesktop hide() leaves the top layer at once, so every menu closes instantly. Notion closes with opacity 1→0 and scale 1→0.96 over 200ms ease. Fix this in shared popover code, with a reduced-motion fallback.
- [ ] P1: The board column tint rounds all four corners. Notion rounds only the bottom (0 0 10px 10px).
- [ ] P1: The measured yellow (~2.2:1) and brown (~3.0:1) column accents are below WCAG AA. Blok's a11y law wins, so this is a documented divergence: use AA-safe text.
- [ ] P3: "Remove sorting" rewrites shared row positions. Check that this matches Notion when other views have their own manual order.
