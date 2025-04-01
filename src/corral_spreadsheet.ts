import path from "path";
import fs from "fs";
import ExcelJS, { Font } from "exceljs";
import { sortBy } from "lodash";

/*****
 * reads in a JSON file and outputs a .xslx file for QC
 *
 * usage: yarn ts-node src/corral_spreadsheet.ts data/local-analysisConfig-paths.json [excel output file]
 *
 * if no excel file given, writes to input file with new .xlsx extension
 */

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
  units: Record<string, string>;
};

const AI_FONT : Partial<Font> = { color: {argb: '#FF8B0000' } };

function toDotXlsx(filePath : string) {
  const { root, dir, name } = path.parse(filePath);
  return path.join(root, dir, name) + ".xlsx";
}

const [,, jsonInputFile, excelOutputFile = toDotXlsx(jsonInputFile)] = process.argv;


if (!jsonInputFile) {
  console.error("Usage: yarn ts-node src/corral_spreadsheet.ts data/local-analysisConfig-paths.json [excel output file]");
  process.exit(1);
}

if (!fs.existsSync(jsonInputFile)) {
  console.error("Input file '${jsonInputFile}' does not exist. Exiting.");
  process.exit(1);
}

// Load JSON
const experiments: Experiment[] = sortBy(
  JSON.parse(fs.readFileSync(jsonInputFile, "utf8")),
  [ 'speciesAndStrain', 'inputQuality' ]
);

// Create workbook and worksheet
const workbook = new ExcelJS.Workbook();
const sheets : Record<string, ExcelJS.Worksheet> = {};

const qcOptions = '"not done,in progress,complete"';

for (const exp of experiments) {
  // choose or create the correct sheet
  const sheet = sheets[exp.componentDatabase] ??= workbook.addWorksheet(exp.componentDatabase);
  // not ideal to repeat this but it works!
  sheet.properties.defaultColWidth = 20;

  const fixedFileName = exp.fileName.replace('./data', '');
  // Add metadata lines
  const metaLines = [
    ['# fileName:', fixedFileName ],
    ['# profileSetName:', exp.experiment],
    ['# speciesAndStrain:', exp.speciesAndStrain],
  ];
  metaLines.forEach(line => sheet.addRow(line));

  const inputQualityRow = sheet.addRow(['# inputQuality:', exp.inputQuality.toString()]);
  inputQualityRow.getCell(2).font = AI_FONT;
  
  // Get unique attribute names for this experiment
  const attributes = Array.from(
    new Set(exp.samples.flatMap(s => s.annotations.map(a => a.attribute)))
  ).sort();

  const headers = ["sample ID", "label", ...attributes, "QC status", "QC notes"];
  const addedHeaderRow = sheet.addRow(headers);
  addedHeaderRow.font = { bold: true };
  for (let i = 0; i < attributes.length; i++) {
    addedHeaderRow.getCell(3 + i).font = { ...AI_FONT, bold:true };
  }

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

    for (let i = 0; i < attributes.length; i++) {
      addedRow.getCell(3 + i).font = AI_FONT;
    }
  }
  
  const units = ["units", "-->", ...attributes.map((attribute) => exp.units[attribute] ?? ''), '', ''];
  const addedUnitsRow = sheet.addRow(units);
  addedUnitsRow.getCell(1).font = { bold: true };
  for (let i = 0; i < attributes.length; i++) {
    addedUnitsRow.getCell(3 + i).font = AI_FONT;
  }
  const unitsQcCell = addedUnitsRow.getCell(units.length - 1);
  unitsQcCell.dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [qcOptions],
      showErrorMessage: true,
    };
  
  sheet.addRow([]);
}

// Save to file
workbook.xlsx.writeFile(excelOutputFile).then(() => {
  console.log(`Spreadsheet written to ${excelOutputFile}`);
});
