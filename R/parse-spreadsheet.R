library(readxl)
library(dplyr)
library(stringr)
library(tidyr)
library(purrr)
library(readr)
library(knitr)

#' Parse a spreadsheet of mini-tables, extract each as metadata, data, and units
#' @param filePath Path to .xlsx file
#' @param process_fn A function to call on each parsed block:
#'                   function(meta_tbl, data_tbl, units_map)
#' @return Invisible NULL
parseSpreadsheet <- function(filePath, process_fn) {
  if (!file.exists(filePath)) {
    stop(glue::glue("File '{filePath}' does not exist. Exiting."))
  }
  if (missing(process_fn) || !is.function(process_fn)) {
    stop("You must supply a process_fn(meta_tbl, data_tbl, units_map) function.")
  }
  
  sheets <- excel_sheets(filePath)
  for (sheetName in sheets) {
    message("Processing sheet: ", sheetName)
    raw <- read_excel(filePath,
                      sheet     = sheetName,
                      col_names = FALSE,
                      col_types = "text")
    
    # find blocks by sentinel row in column A
    starts <- which(str_starts(raw[[1]], "# fileName:"))
    ends   <- c(starts[-1] - 1, nrow(raw))
    
    for (i in seq_along(starts)) {
      block <- raw[starts[i]:ends[i], , drop = FALSE]
      
      # locate header (first non-# non-empty in col A)
      header_row <- which(!str_starts(block[[1]], "#") & str_trim(block[[1]]) != "")[1]
      if (is.na(header_row)) next
      # locate units row by exact match in col A
      unit_row <- which(block[[1]] == "units")
      if (length(unit_row) != 1) {
        stop("Couldn't find a single 'units' row in block starting at ", starts[i])
      }
      
      # parse metadata above header: cols A -> key, B -> value
      meta_rows <- seq_len(header_row - 1)
      keys <- block[meta_rows, 1] %>%
        pull %>%
        str_remove("^#\\s*") %>%
        str_remove(":$") %>%
        str_trim()
      vals <- block[meta_rows, 2] %>% pull() %>% str_trim()
      meta_tbl <- tibble(key = keys, value = vals) %>%
        pivot_wider(names_from = key, values_from = value)
      
      # extract data between header and units
      data_start <- header_row + 1
      data_end   <- unit_row - 1
      data_tbl <- block[data_start:data_end, , drop = FALSE]
      colnames(data_tbl) <- as.character(block[header_row, ])
      # keep only columns with actual headers (not all the blanks on the right)
      data_tbl <- data_tbl %>% select(matches("."))
      
      # create a named vector of unit strings
      all_units <- as.character(block[unit_row, ])
      names(all_units) <- as.character(block[header_row, ])
      # remove the NAs
      all_units <- all_units %>% discard(is.na)

      # find positions of label and QC status
      headers <- colnames(data_tbl)
      label_pos <- which(headers == "label")
      qc_pos    <- which(headers == "QC status")
      
      if (length(label_pos) != 1 || length(qc_pos) != 1) {
        stop("Could not locate 'label' or 'QC status' columns in header.")
      }
      
      # slice units for columns strictly between label and QC status
      if (qc_pos - label_pos >= 1) {
        sel <- seq(label_pos + 1, qc_pos - 1)
        units_map <- all_units[sel]
      } else {
        units_map <- setNames(character(0), character(0))
      }
      
      # hand off to user-provided function to user-provided function
      process_fn(meta_tbl, data_tbl, units_map)
      
      break # just for now
    }
  }
  
  invisible(NULL)
}

# this does not display nicely
processExperiment <- function(meta_tbl, data_tbl, units_map) {
    cat(
    "Metadata",
    kable(meta_tbl),
    "\n\n",
    "Data",
    kable(data_tbl),
    "\n\n",
    "Units",
    units_map
  )
}


parseSpreadsheet('../data/third-reannotation-gpt-4.1-nomissing.xlsx', processExperiment)

