# Lab Meeting Presentation - Maintenance Guide

This document provides guidance for maintaining and updating the AI Model Comparison presentation.

## Presentation Structure

- **Format**: 16:9 PowerPoint presentation (720pt × 405pt slides)
- **Total Slides**: 17 slides
- **Color Palette**: Sage & Terracotta (professional, scientific, welcoming)
  - Sage: #87A96B
  - Terracotta: #E07A5F
  - Cream: #F4F1DE
  - Charcoal: #2C2C2C

## Files in This Directory

- `presentation.pptx` - Main PowerPoint presentation
- `slide-*.html` - Source HTML files for each slide (17 files)
- `create-presentation.js` - Node.js script to generate the presentation from HTML
- `examples/` - HTML examples from comparison results
  - `AGAP001212-claude4_5thinking.html` - Claude summary example
  - `AGAP001212-gpt5.html` - GPT-5 summary example
- `screenshots/` - Directory for screenshot files
  - `README.md` - Guide for which screenshots to capture

## Regenerating the Presentation

If you need to modify slides and regenerate the presentation:

```bash
cd /home/maccallr/work/expression-shepherd

# Make edits to slide-*.html files as needed

# Regenerate the presentation
NODE_PATH=./node_modules node docs/presentations/bob-2025-11-19/create-presentation.js
```

**Note**: The html2pptx library validates slide layouts strictly. Text must fit within slide boundaries with a 0.5" (36pt) margin at the bottom. If you add content, you may need to reduce font sizes or margins.

## Exporting to HTML

To create an HTML version of the presentation for web sharing:

```bash
cd /home/maccallr/work/expression-shepherd/docs/presentations/bob-2025-11-19

# Export using LibreOffice
soffice --headless --convert-to html presentation.pptx

# This creates presentation.html
```

**Alternative**: Use PowerPoint's "Save As" → "Web Page" feature for better formatting preservation.

## Adding Screenshots to Slide 10

Slide 10 currently has a placeholder for screenshots. To add them:

1. Follow the instructions in `screenshots/README.md` to capture the needed screenshots
2. Open `presentation.pptx` in PowerPoint
3. Navigate to Slide 10
4. Delete the placeholder text box
5. Insert your screenshots (Insert → Pictures)
6. Arrange them on the slide as desired
7. Save the presentation

## Updating Content

### Updating Statistics (Slide 9)

If you rerun the comparison with updated data:

1. Check the new aggregate report:
   `/home/maccallr/work/expression-shepherd/comparison/data/aggregate-reports/gpt5/claude4_5thinking-gpt5-report.json`

2. Update slide-09-results.html with new statistics

3. Regenerate the presentation

### Updating Examples (Slide 11)

To change the side-by-side comparison example:

1. Choose a different gene from the 20 genes analyzed
2. Check the HTML summaries in:
   `/home/maccallr/work/expression-shepherd/comparison/data/aggregate-reports/gpt5/html-summaries/`

3. Update `slide-11-comparison.html` with new headline and summary excerpts

4. Regenerate the presentation

## Slide Layout Tips

### Text Overflow Issues

If text overflows after editing, reduce in this order:

1. **Padding/Margins**: Reduce `.content` padding (e.g., from `30pt` to `20pt`)
2. **Font Sizes**: Reduce heading and body font sizes by 1-2pt
3. **Line Height**: Reduce from `1.4` to `1.3` or `1.25`
4. **Content**: Shorten text or split into multiple slides

### Color Palette Usage

- **Headers**: Sage background (#87A96B) with white text
- **Accents**: Terracotta (#E07A5F) for highlights, borders, and emphasis
- **Backgrounds**: Cream (#F4F1DE) for info boxes and subtle backgrounds
- **Text**: Charcoal (#2C2C2C) for body text (not pure black)

## Dependencies

The presentation generation requires:

- `pptxgenjs` - PowerPoint generation library
- `playwright` - Headless browser for HTML rendering
- `sharp` - Image processing

These are installed as dev dependencies:

```bash
yarn add --dev pptxgenjs playwright sharp
```

## Checking in to Git

The `.gitignore` in `comparison/data/` has been configured to:
- ✅ **Include**: `aggregate-reports/` directory (~20MB of final results)
- ❌ **Exclude**: `summaries/`, `comparisons/`, `condensed/` (intermediate data)

This presentation directory should be fully checked into git, including:
- All HTML source files
- The generated .pptx file
- Example HTML summaries
- Screenshot guide
- This CLAUDE.md file

## Troubleshooting

### Playwright browser not found

```bash
npx playwright install chromium
```

### Text validation errors

The html2pptx library enforces strict rules:
- All text must be in `<p>`, `<h1>`-`<h6>`, `<ul>`, or `<ol>` tags
- No manual bullet symbols (•, -, *) - use `<ul>` lists instead
- Content must not overflow the body (720pt × 405pt)
- Text boxes must be at least 0.5" (36pt) from slide bottom

### Module not found errors

Ensure you're running from the repository root and using `NODE_PATH=./node_modules`:

```bash
NODE_PATH=./node_modules node docs/presentations/bob-2025-11-19/create-presentation.js
```

## Future Updates

### Adding New Comparison Models

If you add new models to the comparison:

1. Update the comparison pipeline configuration
2. Run the full comparison workflow
3. Update Slide 9 (results) with new statistics
4. Update Slide 11 (side-by-side) if the winning model changes
5. Update Slide 12 (decision) with new cost estimates

### Presentation for Different Audiences

To adapt this presentation for different audiences:

- **Executive summary** (5 min): Slides 1, 2, 4, 11, 12
- **Technical deep dive** (30 min): All slides
- **Methods focus**: Slides 1, 3, 6, 7, 7a-7d, 8
- **Results focus**: Slides 1, 2, 9, 11, 12

Create separate copies with different slide selections as needed.
