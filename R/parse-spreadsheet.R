library(readxl)
library(dplyr)
library(stringr)
library(tidyr)
library(purrr)
library(readr)
library(knitr)

#' Parse a spreadsheet of mini-tables, extract each as metadata, data, and units
#' @param filePath Path to .xlsx file
#' @param allData a list to accumulate all the data (see `processExperiment` for info on its structure)
#' @param process_fn A function to call on each parsed block:
#'                   function(allData, meta_map, data_tbl, units_map)
#' @return allData accumulated data from passing through `process_fn`
parseSpreadsheet <- function(filePath, allData, process_fn) {
  if (!file.exists(filePath)) {
    stop(glue::glue("File '{filePath}' does not exist. Exiting."))
  }
  if (missing(allData) || !is.list(allData)) {
    stop("You must supply a `data` arg that is a list")
  }
  if (missing(process_fn) || !is.function(process_fn)) {
    stop("You must supply a process_fn(meta_map, data_tbl, units_map) function.")
  }
  
  sheets <- c('PlasmoDB')   # excel_sheets(filePath)
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
      meta_map <- as.list(setNames(vals, keys))

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
      units_map <- as.list(units_map)
      
      # hand off to user-provided function to user-provided function
      allData <- process_fn(allData, meta_map, data_tbl, units_map)
    }
  }
  
  return(invisible(allData))
}

processExperiment <- function(allData, meta_map, data_tbl, units_map) {
  key <- paste(meta_map$speciesAndStrain, meta_map$datasetName, sep="/")
  message(glue::glue("Processing {key} ..."))
  if (allData %>% hasName(key)) {
    message(glue::glue("Appending to {key} ..."))
    # now we need to merge the data
    # first let's check that the units are the same
    prev <- allData[[key]]
    # units check is the simplest
    if (!identical(prev$units, units_map)) {
      cat(
        "Units from", meta_map$profileSetName, ":\n"
      )
      print(units_map)
      cat("are not identical to previous profileSets", prev$meta_map$profileSetName, ":\n")
      print(prev$units)
      stop(glue::glue("Aborting due to unit mismatch for {key}"), call. = FALSE)
    }
    # we should also append `meta$profileSetName` with the extra profileSetName
    prev$meta$profileSetName <- c(prev$meta$profileSetName, meta_map$profileSetName)

    # and now check the data column names and types (via a vec_ptype prototype) are the same
    if (!identical(vctrs::vec_ptype(prev$data), vctrs::vec_ptype(data_tbl))) {
      print("Columns missing: ", setdiff(names(prev$data), names(data_tbl)))
      print("Columns extra: ", setdiff(names(data_tbl), names(prev$data)))
      stop(glue::glue("Aborting due to data columns mismatch for {key}"), call. = FALSE)
    }
    # now bind_rows but watch out for duplicate rows
    unioned <- union(prev$data, data_tbl)
    if (unioned %>% pull('sample ID') %>% anyDuplicated() > 0) {
      stop(glue::glue("Aborting due duplicate 'sample ID' after data union for {key}"), call. = FALSE)
    }
    prev$data <- unioned
    
    allData[[key]] <- prev
  } else {
    allData[[key]] <- list(
      meta = meta_map,
      data = data_tbl,
      units = units_map
    )
  }
  return(allData)
}

allData <- parseSpreadsheet('../data/RNA-Seq sample re-annotation for QC.xlsx', list(), processExperiment)

