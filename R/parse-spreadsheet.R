library(readxl)
library(writexl)
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
  
  sheets <- excel_sheets(filePath)
  for (sheetName in sheets) {
    message("Processing sheet: ", sheetName)
    raw <- suppressMessages( # added later to suppress annoying "New names:" messages
      read_excel(filePath,
                 sheet     = sheetName,
                 col_names = FALSE,
                 col_types = "text")
    )  
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
      meta_map$projectId <- sheetName

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

      # find positions of label and QC status
      headers <- colnames(data_tbl)
      label_pos <- which(headers == "label")
      qc_pos    <- which(headers == "QC status")
      
      if (length(label_pos) != 1 || length(qc_pos) != 1) {
        stop("Could not locate 'label' or 'QC status' columns in header.")
      }
      
      # slice units for columns strictly between label and QC status
      if (qc_pos - label_pos > 1) {
        sel <- seq(label_pos + 1, qc_pos - 1)
        units_map <- all_units[sel]
      } else {
        units_map <- setNames(character(0), character(0))
      }
      units_map <- as.list(units_map)
      
      if (any(units_map %>% is.na())) {
        stop(glue::glue("Fatal error: missing units in {meta_map$fileName}"))
      }
      
      # join the two ID columns into a single underscore-delimited 'combined ID' column
      # and make the `fallback ID` column
      data_tbl <- data_tbl %>%
        unite('combined ID', 'sample ID', 'SRA ID(s)', remove = FALSE) %>%
        mutate(
          `fallback ID` = coalesce(`SRA ID(s)`, `sample ID`)
        )

      # hand off to user-provided function to user-provided function
      allData <- process_fn(allData, meta_map, data_tbl, units_map)
    }
  }
  
  return(invisible(allData))
}

#'
#' append-or-add to `allData` the experiment data passed in
#'
#' uses a key made from species/datasetName
#' 
#' `allData` is a list and the key is used for named lookup
#'
#' various consistency checks are made if appending (variables must be the same)
#' 
#' actually it's a union rather than append but you get the idea...
#'
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
    # now union the data tibbles but if rows with the same sample IDs didn't have identical row content
    # we should throw an error (sample ID should remain unique after the union)
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

#'
#' filter `allData` keeping only experiments with data where
#' at least one of the label and annotation variable columns contains
#' at least two different values that are replicated at least two times each
#' (so DESeq2 can compare at least 2 vs. 2 samples)
#'
#'
#'

# helper: given a vector x, count how many unique values occur ≥2 times
count_replicated_levels <- function(x) {
  tbl <- table(x, useNA = "no")     # drop NAs automatically
  sum(tbl >= 2)
}

keepContrastingOnly <- function(allData) {
  allData %>%
    keep(function(expt) {
      column_names <- c('label', names(expt$units)) # columns 'label' plus any annotation columns like 'sex', 'age' etc

      # For each column, count how many levels have ≥2 replicates
      replicated_level_counts <- expt$data %>%
        summarise(across(all_of(column_names), count_replicated_levels)) %>%
        unlist()
      
      # keep if any variable has at least two such levels
      any(replicated_level_counts >= 2)
    })
}


#'
#' Takes the `allData` list of experimentKey -> {meta, data, units}
#'
#' For each experimentKey, count the percent overlap of sample IDs in `data`
#'
#' Returns a list keyed again by experimentKey
#' with entries only when that experiment overlaps with another experiment.
#' 
#' `column_name` is an optional argument
#' default value is 'combined ID' which is a concatenation of the 'sample ID' and 'SRA ID(s)' columns
#' you could use 'sample ID' or the other special column 'fallback ID' which is
#' SRA falling-back to sample ID if not present.
#' 
#' The returned tibble has the following columns and has rows only where there
#' is a non-zero overlap
#'
#' project1: e.g. HostDB
#' project2: e.g. PlasmoDB
#' experiment1: organism/experiment1
#' experiment2: organism/experiment2
#' percent_overlap_2_with_1: how much of 2 overlaps with 1
#' percent_overlap_1_with_2: and in the other direction
#'
determineOverlaps <- function(allData, column_name = 'combined ID') {
  overlap_tbl <- tibble()
  experiment_keys <- names(allData)
  
  for (i in seq_along(experiment_keys)) {
    key1 <- experiment_keys[i]
    samples1 <- allData[[key1]]$data[[column_name]]
    
    result <- list()
    
    for (j in seq_along(experiment_keys)) {
      key2 <- experiment_keys[j]
      if (key1 == key2) break # only do A vs B (not B vs A too)
      
      samples2 <- allData[[key2]]$data[[column_name]]
      shared <- intersect(samples1, samples2)
      if (length(samples1) == 0) next  # avoid div by zero
      
      percent_overlap_2_with_1 <- length(shared) / length(samples1) * 100
      percent_overlap_1_with_2 <- length(shared) / length(samples2) * 100
      
      if (percent_overlap_1_with_2 + percent_overlap_1_with_2 > 0) {
        overlap_tbl <- bind_rows(
          overlap_tbl,
          tibble(
            project1 = allData[[key1]]$meta$projectId,
            project2 = allData[[key2]]$meta$projectId,
            experiment1 = key1,
            experiment2 = key2,
            percent_overlap_2_with_1 = percent_overlap_2_with_1,
            percent_overlap_1_with_2 = percent_overlap_1_with_2
          )
        )
      }
    }
  }
  
  return(overlap_tbl)
}

writeSampleSTF <- function(data, output_directory) {
  data %>% walk(
    function(d) {
      organism <- d$meta$speciesAndStrain
      dataset <- d$meta$datasetName
      path <- file.path(output_directory, organism, dataset)
      if (!dir.exists(path)) {
        dir.create(path, recursive = TRUE)
      }
      # remove unwanted columns before we make the EDA entity
      sdata <- d$data %>% select(-c(`combined ID`, `QC status`, `QC notes`, `fallback ID`))

      samples <- entity_from_tibble(sdata, name = 'sample')

      samples <- samples %>%
        redetect_columns_as_variables(columns = c('SRA.ID.s.', 'label')) %>%
        set_variable_display_names_from_provider_labels() %>%
        set_variable_metadata('SRA.ID.s.', display_name = 'SRA ID(s)')
      
      # remove SRA ID(s) column if it's empty
      if (samples %>% get_data() %>% pull(SRA.ID.s.) %>% is.na() %>% all()) {
        samples <- samples %>%
          modify_data(
            select(-SRA.ID.s.)
          )  %>%
          sync_variable_metadata()
      } else {
        samples <- samples %>% set_variables_multivalued('SRA.ID.s.' = ',')
      }
      
      # annotate the units
      samples <- reduce2(
        .x    = d$units,          # the values
        .y    = make.names(names(d$units)),   # the "R-friendly" column names
        .init = samples,          # start here
        .f    = function(acc, unit, col) {
          # only set on numeric columns
          if (unit != "no unit" && acc %>% get_data() %>% pull(col) %>% is.numeric()) {
            acc <- set_variable_metadata(acc, col, unit = unit)
          }
          acc
        }
      )
      
      if (samples %>% validate() == FALSE) {
        break;
      }
      
      samples %>% export_entity_to_stf(path)
    }
  )
}

allData <- parseSpreadsheet('../data/RNA-Seq sample re-annotation for QC.xlsx', list(), processExperiment)
message("Filtering to keep only contrasting experiments.")
contrasting <- keepContrastingOnly(allData)
message("Determining overlaps... (takes a minute)")
overlaps_both_tbl <- determineOverlaps(contrasting, 'combined ID')
overlaps_sra_tbl <- determineOverlaps(contrasting, 'fallback ID')
write_xlsx(
  x = list(
    CombinedID_Overlaps = overlaps_both_tbl,
    FallbackID_Overlaps = overlaps_sra_tbl
  ),
  path = "../data/overlaps.xlsx"
)
writeSampleSTF(contrasting, '../data/sample_stf/')
