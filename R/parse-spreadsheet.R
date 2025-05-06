
parseSpreadsheet <- function(filePath) {
  if (!file.exists(filePath)) {
    stop(glue::glue("File '{filePath}' does not exist. Exiting."))
  }
 
  sheetNames <- readxl::excel_sheets(filePath)
  for (sheet in sheetNames) {
    
    print(sheet)
  }
}

parseSpreadsheet('../data/third-reannotation-gpt-4.1-nomissing.xlsx')
