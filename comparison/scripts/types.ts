// ============================================================================
// Configuration Types
// ============================================================================

export interface SiteConfig {
  name: string;
  hostname: string;
  appPath: string;
  model: string;
  skip?: boolean;
}

export interface Config {
  sites: SiteConfig[];
  endpoint: string;
  projectId: string;
}

// ============================================================================
// Expression Summary Types
// ============================================================================

export interface ExperimentSummary {
  assay_type: string;
  experiment_name: string;
  notes: string;
  one_sentence_summary: string;
  confidence: string | number;
  dataset_id: string;
  experiment_keywords: string[];
  biological_importance: string | number;
}

export interface Topic {
  one_sentence_summary: string;
  headline: string;
  summaries: ExperimentSummary[];
}

export interface ExpressionSummary {
  one_paragraph_summary: string;
  headline: string;
  topics: Topic[];
}

export interface SimplifiedTopic {
  one_sentence_summary: string;
  headline: string;
  experiment_names: string[];
}

export interface SimplifiedSummary {
  one_paragraph_summary: string;
  headline: string;
  topics: SimplifiedTopic[];
}

// ============================================================================
// Metrics Types
// ============================================================================

export interface DeterministicMetrics {
  character_count: number;
  word_count: number;
  sentence_count: number;
  paragraph_count: number;
  topic_count: number;
  has_bullets: boolean;
  average_sentence_length: number;
}

// ============================================================================
// Comparison Types
// ============================================================================

export interface BiologicalContentCounts {
  only_in_A: string[];
  only_in_B: string[];
  in_both: string[];
}

export interface BiologicalContent {
  observations: BiologicalContentCounts;
  insights: BiologicalContentCounts;
}

export interface QualitativeCategory {
  summary_A: string;
  summary_B: string;
  comparison: string;
}

export interface QualitativeAssessment {
  tone_and_style: QualitativeCategory;
  technical_detail_level: QualitativeCategory;
  structure_and_organization: QualitativeCategory;
}

export interface QuantitativeMentions {
  summary_A: number;
  summary_B: number;
}

export interface ComparisonResult {
  model_A: string;
  model_B: string;
  gene_id: string;
  biological_content: BiologicalContent;
  qualitative_assessment: QualitativeAssessment;
  deterministic_metrics: {
    summary_A: DeterministicMetrics;
    summary_B: DeterministicMetrics;
  };
  quantitative_expression_mentions: QuantitativeMentions;
  token_usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

// ============================================================================
// Condensation Types
// ============================================================================

export interface BiologicalContentSummary {
  avg_unique_to_model_A: number;
  avg_unique_to_model_B: number;
  avg_shared: number;
  position_variance: number;
}

export interface MergedQualitativeAssessment {
  tone_and_style: QualitativeCategory;
  technical_detail_level: QualitativeCategory;
  structure_and_organization: QualitativeCategory;
  contradiction_detected: boolean;
  merge_notes: string;
}

export interface CondensedComparison {
  gene_id: string;
  model_A: string;
  model_B: string;
  biological_content_summary: {
    observations: BiologicalContentSummary;
    insights: BiologicalContentSummary;
  };
  qualitative_assessment: MergedQualitativeAssessment;
  deterministic_metrics: {
    model_A: DeterministicMetrics;
    model_B: DeterministicMetrics;
  };
  quantitative_mentions: {
    avg_model_A: number;
    avg_model_B: number;
  };
}

// ============================================================================
// Fetch Types
// ============================================================================

export interface FetchResult {
  geneId: string;
  site: string;
  status: "success" | "failed";
  error?: string;
}

// ============================================================================
// Aggregate Analysis Types
// ============================================================================

export interface StatisticalMetric {
  summary: string; // e.g., "Model A significantly higher (p=0.003)" or "No significant difference (p=0.342)"
  mean_A: number;
  std_err_A: number;
  mean_B: number;
  std_err_B: number;
  t_test_pval: number;
}

export interface DescriptiveMetric {
  mean: number;
  std_err: number;
}

export interface BiologicalContentMetric {
  avg_unique_to_model_A: DescriptiveMetric;
  avg_unique_to_model_B: DescriptiveMetric;
  avg_shared: DescriptiveMetric;
  avg_position_variance: DescriptiveMetric;
}

export interface BiologicalContentAggregate {
  observations: BiologicalContentMetric;
  insights: BiologicalContentMetric;
}

export interface DeterministicMetricsAggregate {
  word_count: StatisticalMetric;
  topic_count: StatisticalMetric;
  sentence_count: StatisticalMetric;
  character_count: StatisticalMetric;
  paragraph_count: StatisticalMetric;
  average_sentence_length: StatisticalMetric;
  has_bullets_percent: {
    percent_A: number;
    percent_B: number;
    note: string;
  };
}

export interface PositionBiasAggregate {
  contradiction_rate_percent: number;
  genes_with_contradictions: string[];
}

export interface AgreementDistribution {
  strong_agreement: string[];
  mild_agreement: string[];
  neutral_mixed: string[];
  mild_disagreement: string[];
  strong_disagreement: string[];
}

export type ConsistencyScore = "High consistency" | "Moderate consistency" | "Low consistency";

export interface QualitativeFieldAggregate {
  consensus_summary: string;
  consistency_score: ConsistencyScore;
  agreement_distribution: AgreementDistribution;
  disagreement_analysis: string;
}

export interface QualitativeDimensionAggregate {
  summary_A: QualitativeFieldAggregate;
  summary_B: QualitativeFieldAggregate;
  comparison: QualitativeFieldAggregate;
}

export interface QualitativeAggregates {
  tone_and_style: QualitativeDimensionAggregate;
  technical_detail_level: QualitativeDimensionAggregate;
  structure_and_organization: QualitativeDimensionAggregate;
}

export interface QuantitativeAggregates {
  biological_content: BiologicalContentAggregate;
  deterministic_metrics: DeterministicMetricsAggregate;
  quantitative_mentions: StatisticalMetric;
  position_bias: PositionBiasAggregate;
}

export interface AggregateReport {
  model_pair: {
    model_A: string;
    model_B: string;
  };
  gene_count: number;
  quantitative_aggregates: QuantitativeAggregates;
  qualitative_aggregates: QualitativeAggregates;
}
