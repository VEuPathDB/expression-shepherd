import path from "path";
import fs from "fs";
import ExcelJS, { Font } from "exceljs";
import { sortBy } from "lodash";
import { ExperimentInfo } from "./types";

/*****
 * reads in a JSON file and outputs a .xslx file for QC
 *
 * usage: yarn ts-node src/corral_spreadsheet.ts data/local-analysisConfig-paths.json [excel output file]
 *
 * if no excel file given, writes to input file with new .xlsx extension
 */

// can't we get these from types.ts?
type Annotation = { attribute: string; value: string };
type Sample = {
  id: string;
  sra_ids: string;
  label: string;
  annotations: Annotation[];
};
type Experiment = {
  fileName: string;
  profileSetName: string;
  experiment: ExperimentInfo;
  componentDatabase: string;
  speciesAndStrain: string;
  inputQuality: number;
  samples: Sample[];
  units: Record<string, string>;
  usedNcbi: boolean;
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
  [ 'speciesAndStrain', 'fileName' ]
);

// Create workbook and worksheet
const workbook = new ExcelJS.Workbook();
const sheets : Record<string, ExcelJS.Worksheet> = {};

const qcOptions = '"fail: major edits needed,fail: minor edits needed,pass: major edits made,pass: minor edits made,pass: no edits required"';

for (const exp of experiments) {
  // choose or create the correct sheet
  const sheet = sheets[exp.componentDatabase] ??= workbook.addWorksheet(exp.componentDatabase);
  // not ideal to repeat this but it works!
  sheet.properties.defaultColWidth = 20;

  const fixedFileName = exp.fileName.replace('./data', '');

  const parts = fixedFileName.split('/');
  const datasetName = parts[8];
  // Add metadata lines
  const metaLines = [
    ['# fileName:', fixedFileName ],
    ['# datasetName:', datasetName ],
    ['# profileSetName:', exp.profileSetName],
    ['# speciesAndStrain:', exp.speciesAndStrain],
    ['# experimentName:', exp.experiment.name?.replace(/[\n\t]+/g, ' ') ?? ''],
    ['# experimentSummary:', exp.experiment.summary?.replace(/[\n\t]+/g, ' ') ?? ''],
    ['# experimentDescription:', exp.experiment.description?.replace(/[\n\t]+/g, ' ') ?? ''],
    ['# ncbiAnnotationsProvidedToAi:', exp.usedNcbi ? 'Yes' : 'No'],
  ];
  metaLines.forEach(line => sheet.addRow(line));

  const inputQualityRow = sheet.addRow(['# inputQuality:', exp.inputQuality.toString()]);
  inputQualityRow.getCell(2).font = AI_FONT;
  
  // Get unique attribute names for this experiment
  const attributes = Array.from(
    new Set(exp.samples.flatMap(s => s.annotations.map(a => a.attribute)))
  ).sort();

  const headers = ["sample ID", "SRA ID(s)", "label", ...attributes, "QC status", "QC notes"];
  const addedHeaderRow = sheet.addRow(headers);
  addedHeaderRow.font = { bold: true };
  for (let i = 0; i < attributes.length; i++) {
    addedHeaderRow.getCell(4 + i).font = { ...AI_FONT, bold:true };
  }

  for (const sample of exp.samples) {
    const annMap: Record<string, string> = {};
    sample.annotations.forEach(a => {
      annMap[a.attribute] = a.value;
    });

    const rowData = [
      sample.id,
      sample.sra_ids || (exp.usedNcbi && sample.id.match(/^[SED]R[RXS]\d+$/) ? sample.id : ''),
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
      addedRow.getCell(4 + i).font = AI_FONT;
    }
  }
  
  const units = ["units", "-->", "-->", ...attributes.map((attribute) => exp.units[attribute] ?? 'no unit'), '', ''];
  const addedUnitsRow = sheet.addRow(units);
  addedUnitsRow.getCell(1).font = { bold: true };
  for (let i = 0; i < attributes.length; i++) {
    addedUnitsRow.getCell(4 + i).font = AI_FONT;
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
