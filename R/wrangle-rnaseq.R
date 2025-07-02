#
# reads in the tall counts file (one row per gene)
# and flips it round to wide
#
read_counts_data <- function(filename) {

  message(glue("reading {filename}..."))
  # read in as all-character
  suppressMessages(
    data <- read_tsv(
      filename,
      col_names = FALSE,
      col_types = cols(.default = "c")
    ) %>%
      # and transpose
      t() %>% as_tibble(.name_repair = 'unique')
  )
  message(glue("read {filename}, doing headers..."))
  
  # Extract the header row
  headers <- data %>% slice_head(n = 1) %>% unlist(use.names = FALSE)
  headers[1] <- 'sample.ID'
  # Drop header row
  data <- data %>% slice_tail(n = nrow(data) - 1)
  # Name the columns and we're back to a proper tibble
  colnames(data) <- headers

  message(glue("read {filename}, doing headers and integer conversion..."))
  # convert the counts columns to integer
  # and make a trivial assay ID column
  data <- data %>%
    mutate(
      across(
        -sample.ID,
        as.integer
      ),
      assay.ID = sample.ID
    ) %>%
    relocate(assay.ID, .after = sample.ID) %>%
    select(-starts_with('__'))
  
  
  return(data)
}

#
# figures out which countsForEda file is sense/antisense
#
# returns a named ("sense", "antisense" or "unstranded") list of tibbles
#
rename_counts_by_strandedness <- function(counts_list) {
  if (length(counts_list) == 1) {
    # Only one file → label it unstranded
    names(counts_list) <- "unstranded"
    return(counts_list)
  }
  
  stopifnot(length(counts_list) == 2)
  
  # Extract tibbles
  x <- counts_list[[1]]
  y <- counts_list[[2]]
  
  # Remove metadata columns (assumes first 2 cols are not genes)
  x_counts <- x %>% select(-1, -2)
  y_counts <- y %>% select(-1, -2)
  
  # Compute per-sample sums (across each row)
  x_sums <- rowSums(x_counts)
  y_sums <- rowSums(y_counts)
  
  if (all(x_sums > y_sums)) {
    names(counts_list) <- c("sense", "antisense")
  } else if (all(x_sums < y_sums)) {
    names(counts_list) <- c("antisense", "sense")
  } else {
    stop("Strandedness could not be consistently determined for ", names(counts_list))
  }

  counts_list
}

counts_to_entity <- function(tbl, name) {
  assays <- entity_from_tibble(
    tbl,
    name = paste0(name, "_assay"),
    display_name = paste(str_to_title(name), 'assay'),
    display_name_plural = paste(str_to_title(name), 'assays'),
    skip_type_convert = TRUE
    #TO DO, description = ???
  ) %>%
    set_parents('sample', 'sample.ID')
  
  assays <- assays %>%
    create_variable_category(
      category_name = 'gene_counts',
      children = assays %>% get_variable_metadata() %>% pull(variable),
      display_name = 'Gene counts',
      definition = 'Counts per gene from RNA-Seq'  
    ) %>%
    create_variable_collection(
      'gene_counts',
      member = 'gene',
      member_plural = 'genes'
      # TO DO: normalization_method? is_compositional?
    )
  
  assays
}

#
# the main event... wrangle()
#
wrangle <- function(projectId, speciesAndStrain, datasetName) {
  
  # find the sample STF file
  sample_filename <- file.path(
    '../data/sample_stf',
    speciesAndStrain,
    datasetName,
    'entity-sample.tsv'
  )
  
  # find the countsForEda_*.txt files
  counts_file_glob <- file.path(
    '../data/ReflowPlus-data',
    projectId,
    speciesAndStrain,
    'rnaseq',
    paste(speciesAndStrain, datasetName, '*', 'RSRC', sep = '_'),
    'analysis_output/countsForEda*.txt'
  )
  counts_filenames <- Sys.glob(counts_file_glob)
  
  counts_data <- counts_filenames %>%
    set_names() %>%
    map(read_counts_data) %>%
    rename_counts_by_strandedness() %>%
    imap(counts_to_entity)
  
  # the entity will have the name 'sample'
  samples <- entity_from_stf(sample_filename)
  
  study <- study_from_entities(c(samples, counts_data), name = "RNA-Seq study")
  
  study
}


# for testing

projectId <- 'PlasmoDB'
speciesAndStrain <- 'pfal3D7'
datasetName <- 'Bartfai_IDC_2018'

# study <- wrangle(projectId, speciesAndStrain, datasetName)
# validate(study)
# inspect(study)
# (do not inspect entities - it is unusably slow - bug issue #41 filed)

# example VDI export
# study %>% export_to_vdi(some_directory)
