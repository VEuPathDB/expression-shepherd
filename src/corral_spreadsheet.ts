import path from "path";
import fs from "fs";
import ExcelJS from "exceljs";

type Annotation = { attribute: string; value: string };
type Sample = {
  id: string;
  label: string;
  annotations: Annotation[];
};
type Experiment = {
  fileName: string;
  experiment: string;
  componentDatabase: string;
  speciesAndStrain: string;
  inputQuality: number;
  samples: Sample[];
};

function toDotXlsx(filePath : string) {
  const { root, dir, name } = path.parse(filePath);
  return path.join(root, dir, name) + ".xlsx";
}

const [,, jsonInputFile, excelOutputFile = toDotXlsx(jsonInputFile)] = process.argv;

// Load JSON
const experiments: Experiment[] = JSON.parse(fs.readFileSync(jsonInputFile, "utf8"));

// Create workbook and worksheet
const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet("Sample QC");
sheet.properties.defaultColWidth = 20; // applies to all columns

const qcOptions = '"not done,in progress,complete"';

for (const exp of experiments) {
  // Add metadata lines
  const metaLines = [
    `# fileName: ${exp.fileName}`,
    `# experiment: ${exp.experiment}`,
    `# componentDatabase: ${exp.componentDatabase}`,
    `# speciesAndStrain: ${exp.speciesAndStrain}`,
    `# inputQuality: ${exp.inputQuality}`,
  ];
  metaLines.forEach(line => sheet.addRow([line]));
  
  // Get unique attribute names for this experiment
  const attributes = Array.from(
    new Set(exp.samples.flatMap(s => s.annotations.map(a => a.attribute)))
  ).sort();

  const headers = ["sample ID", "label", ...attributes, "QC status", "QC notes"];
  const addedHeaderRow = sheet.addRow(headers);
  addedHeaderRow.font = { bold: true };

  for (const sample of exp.samples) {
    const annMap: Record<string, string> = {};
    sample.annotations.forEach(a => {
      annMap[a.attribute] = a.value;
    });

    const rowData = [
      sample.id,
      sample.label,
      ...attributes.map(attr => annMap[attr] || ""),
      "",
      "",
    ];
    const addedRow = sheet.addRow(rowData);

    // Add dropdown to last-but-one cell (QC status)
    const qcCell = addedRow.getCell(headers.length - 1);
    qcCell.dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [qcOptions],
      showErrorMessage: true,
    };
  }

  sheet.addRow([]);
}

// Save to file
workbook.xlsx.writeFile(excelOutputFile).then(() => {
  console.log(`Spreadsheet written to ${excelOutputFile}`);
});
