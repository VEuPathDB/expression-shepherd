import { writeFile } from "fs/promises";
import { FullIndividualResponseType, SummaryResponseType } from "./types";

export async function writeToFile(filename: string, content: string): Promise<void> {
  try {
    await writeFile(filename, content, "utf-8");
    console.log(`File written successfully to ${filename}`);
  } catch (error) {
    console.error("Error writing to file:", error);
  }
}

// Usage example (in an async function):
//
// const filename = "output.txt";
// const content = "This is a test content for the file.";
// await writeToFile(filename, content);



export function summaryJSONtoHTML(
  summaryResponse: SummaryResponseType,
  geneId: string,
  individualResults: FullIndividualResponseType[],
  expressionGraphs: any[],
  serverUrl: string,
): string {
  // Destructure the summary response
  const { headline, one_paragraph_summary, sections } = summaryResponse;

  // Build the HTML structure
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${geneId} - Expression Summary</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; margin: 20px; }
    h1, h2, h3 { color: #333; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f4f4f4; }
    img { max-width: 100px; }
  </style>
</head>
<body>
  <h1>${geneId} - ${headline}</h1>
  <p>${one_paragraph_summary}</p>
  ${sections.map(section => `
    <section>
      <h2>${section.headline}</h2>
      <p>${section.one_sentence_summary}</p>
      <table>
        <thead>
          <tr>
            <th>Preview</th>
            <th>Name</th>
            <th>Summary</th>
            <th>Attribution</th>
            <th>Assay Type</th>
          </tr>
        </thead>
        <tbody>
    ${section.dataset_ids.map(datasetId => {
      const expressionGraph = expressionGraphs.find(({dataset_id} : {dataset_id: string }) => datasetId == dataset_id);
      const individualResult = individualResults.find(({dataset_id} : {dataset_id: string}) => datasetId == dataset_id);
      const thumbnailRaw = expressionGraph['thumbnail'] as string;
      const thumbnailFinal = thumbnailRaw.replace('/cgi-bin', `${serverUrl}/cgi-bin`);
      return `
<tr>
<td>${thumbnailFinal}</td>
<td>${individualResult?.display_name}</td>
<td>${individualResult?.one_sentence_summary}</td>
<td>${expressionGraph?.short_attribution}</td>
<td>${individualResult?.assay_type}</td>
</tr>`;
    }).join('')}
        </tbody>
      </table>
    </section>
  `).join('')}
</body>
</html>
  `;

  return html;
}
