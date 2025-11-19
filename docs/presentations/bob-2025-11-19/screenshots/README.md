# Screenshot Guide for Lab Meeting Presentation

This guide lists the screenshots you should capture before presenting to add to **Slide 10: Browse the Results**.

## Screenshots to Capture

### 1. Index Page - Comparison Matrix
**File:** `/home/maccallr/work/expression-shepherd/comparison/data/aggregate-reports/gpt5/index.html`

**What to capture:**
- Open in browser
- Capture the full comparison matrix showing all model pairs
- Show the navigation with HTML/JSON links for each comparison

### 2. Gene Summary - Claude 4.5 Thinking (AGAP001212)
**File:** `/home/maccallr/work/expression-shepherd/comparison/data/aggregate-reports/gpt5/html-summaries/AGAP001212-claude4_5thinking.html`

**What to capture:**
- Gene headline
- One-paragraph summary (note the **bold** formatting and narrative style)
- First 2-3 topics with expandable sections
- Highlight the use of quantitative details (percentiles, fold changes)

### 3. Gene Summary - GPT-5 (AGAP001212)
**File:** `/home/maccallr/work/expression-shepherd/comparison/data/aggregate-reports/gpt5/html-summaries/AGAP001212-gpt5.html`

**What to capture:**
- Gene headline
- One-paragraph summary (note the bullet list structure and neutral tone)
- First 2-3 topics
- Contrast with Claude's warmer, narrative approach

### 4. Aggregate Report - Statistics Excerpt
**File:** `/home/maccallr/work/expression-shepherd/comparison/data/aggregate-reports/gpt5/claude4_5thinking-gpt5-report.html`

**What to capture:**
- Scroll to the "Deterministic Metrics" section
- Capture the table showing word count, quantitative mentions with p-values
- Optionally capture the "Position Bias" section showing 0% contradiction rate

## Tips for Screenshots

- Use browser zoom to make text readable in presentation context
- Crop to focus on relevant content, removing browser chrome
- Save as PNG with descriptive names (e.g., `index-matrix.png`, `agap001212-claude.png`)
- Place screenshots in the `screenshots/` directory
- In PowerPoint, replace the placeholder on Slide 10 with your screenshots

## Alternative: Live Demo

Instead of screenshots, you can also:
1. Open the HTML files in separate browser tabs before presenting
2. Switch to them during the presentation for a live walkthrough
3. Use the hover popups on gene IDs to jump between model versions
