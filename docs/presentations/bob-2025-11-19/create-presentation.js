const pptxgen = require('pptxgenjs');
const html2pptx = require('/home/maccallr/.claude/skills/pptx/scripts/html2pptx.js');
const path = require('path');

async function createPresentation() {
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'Bob MacCallum, VEuPathDB Team';
  pptx.title = 'AI Model Comparison for Gene Expression Summarization';

  const slideFiles = [
    'slide-01-title.html',
    'slide-02-problem.html',
    'slide-03-two-step.html',
    'slide-04-claude-port.html',
    'slide-05-gold-standard.html',
    'slide-06-genes.html',
    'slide-07-pipeline.html',
    'slide-07a-phase1.html',
    'slide-07b-phase2.html',
    'slide-07c-phase25.html',
    'slide-07d-phase34.html',
    'slide-08-dimensions.html',
    'slide-09-results.html',
    'slide-10-browse.html',
    'slide-11-comparison.html',
    'slide-12-decision.html',
    'slide-13-meta.html'
  ];

  console.log('Creating presentation with 17 slides...');

  for (const file of slideFiles) {
    const filePath = path.join(__dirname, file);
    console.log(`Processing ${file}...`);
    await html2pptx(filePath, pptx);
  }

  const outputPath = path.join(__dirname, 'presentation.pptx');
  await pptx.writeFile({ fileName: outputPath });
  console.log(`Presentation created: ${outputPath}`);
}

createPresentation().catch(console.error);
