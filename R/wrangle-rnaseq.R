projectId <- 'PlasmoDB'
speciesAndStrain <- 'pfal3D7'
datasetName <- 'Bartfai_IDC_2018'

#
# reads in the tall counts file (one row per gene)
# and flips it round to wide
#
read_counts_data <- function(filename) {

  # read in as all-character  
  data <- read_tsv(
    filename,
    col_names = FALSE,
    col_types = cols(.default = "c")
  ) %>%
    t() %>%
    as_tibble()
  
  # Extract the header row
  headers <- data %>% slice_head(n = 1) %>% unlist(use.names = FALSE)
  headers[1] <- 'sample.ID'
  # Drop header row
  data <- data %>% slice_tail(n = nrow(data) - 1)
  # Name the columns and we're back to a proper tibble
  colnames(data) <- headers

  # convert the counts columns to integer
  data <- data %>%
    mutate(
      across(
        -sample.ID,
        as.integer
      )
    )
  
  return(data)
}


wrangle <- function(speciesAndStrain, datasetName) {
  
  sample_filename <- file.path(
    '../data/sample_stf',
    speciesAndStrain,
    datasetName,
    'entity-sample.tsv'
  )
  
  counts_file_glob <- file.path(
    '../data/ReflowPlus-data',
    projectId,
    speciesAndStrain,
    'rnaseq',
    paste(speciesAndStrain, datasetName, '*', 'RSRC', sep = '_'),
    'analysis_output/countsForEda*.txt'
  )
  counts_filenames <- Sys.glob(counts_file_glob)
  
  samples <- entity_from_stf(sample_filename)
  
  
}
