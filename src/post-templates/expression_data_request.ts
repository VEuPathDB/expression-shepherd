// expressionDataRequestPostData.primaryKey[0].value needs to be overwritten when used
// request URL: https://plasmodb.org/plasmo/service/record-types/gene/records
// content-type: application/json

// source_id is a gene ID
// project_id is 'PlasmoDB' for example

type ExpressionDataRequestPostData = {
  attributes: string[],
  primaryKey: {
    name: string,
    value: string
  }[],
  tables: string[]
}

export const expressionDataRequestPostData : ExpressionDataRequestPostData = {
  "attributes": [
    "exon_count",
    "transcript_count",
    "gene_type",
    "genus_species",
    "is_pseudo",
    "name",
    "ds_annotation_version",
    "external_db_name",
    "external_db_version",
    "record_overview",
    "source_id"
  ],
  "primaryKey": [
    {
      "name": "source_id",
      "value": "####"
    },
    {
      "name": "project_id",
      "value": "####"
    }
  ],
  "tables": [
    "ExpressionGraphs",
    "ExpressionGraphsDataTable"
  ]
};
