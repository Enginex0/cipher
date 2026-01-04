/**
 * Types for Claude-Hybrid Incremental Analysis Tools
 *
 * This module defines TypeScript interfaces for envelopes, snapshots,
 * delta manifests, impact graphs, and related structures.
 */

// =============================================================================
// ENVELOPE TYPES
// =============================================================================

export type WorkflowGoal = 'AUDIT' | 'DOCUMENT' | 'BUILD_FRONTEND';
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type ValidationStatus = 'PENDING' | 'VERIFIED' | 'PARTIAL' | 'REJECTED';

export interface EnvelopeFindings {
	[key: string]: any;
}

export interface Envelope {
	envelope_id: string;
	tier: number;
	agent: string;
	project: string;
	workflow_id: string;
	workflow_goal: WorkflowGoal;
	chunk_id: string;
	chunk_index: number;
	total_chunks: number;
	chunk_path?: string;
	git_commit: string;
	git_branch?: string;
	confidence: ConfidenceLevel;
	validation_status: ValidationStatus;
	findings: EnvelopeFindings;
	findings_count: number;
	external_refs?: string[];
	created_at: string;
	updated_at: string;
}

export interface EnvelopeStoreParams {
	tier: number;
	agent: string;
	project: string;
	workflow_id: string;
	workflow_goal: WorkflowGoal;
	chunk_id: string;
	chunk_index: number;
	total_chunks: number;
	git_commit: string;
	confidence: ConfidenceLevel;
	findings: EnvelopeFindings;
	findings_count?: number;
	chunk_path?: string;
	git_branch?: string;
	external_refs?: string[];
}

export interface EnvelopeQueryParams {
	tier?: number;
	agent?: string;
	chunk_id?: string;
	workflow_id?: string;
	project?: string;
	validation_status?: ValidationStatus;
	confidence?: ConfidenceLevel;
	semantic_query?: string;
	limit?: number;
}

// =============================================================================
// SNAPSHOT TYPES
// =============================================================================

export type AnalysisMode = 'FULL' | 'INCREMENTAL' | 'REBASE';

export interface ChunkManifest {
	[chunkId: string]: {
		files: string[];
		status: 'ANALYZED' | 'SKIPPED' | 'PENDING';
		fingerprint: string;
	};
}

export interface TrustScore {
	overall: number;
	level: 'HIGH' | 'MEDIUM' | 'LOW';
	components: {
		coverage: number;
		freshness: number;
		confidence: number;
	};
}

export interface Snapshot {
	snapshot_id: string;
	project_path: string;
	git_commit: string;
	git_branch: string;
	workflow_id: string;
	workflow_goal: WorkflowGoal;
	analysis_mode: AnalysisMode;
	baseline_snapshot_id?: string;
	chunk_manifest: ChunkManifest;
	findings: string[]; // envelope IDs
	trust_score: TrustScore;
	duration_seconds: number;
	created_at: string;
	provenance_chain: string[];
}

export interface SnapshotCreateParams {
	project_path: string;
	git_commit: string;
	git_branch: string;
	workflow_id: string;
	workflow_goal: WorkflowGoal;
	analysis_mode: AnalysisMode;
	baseline_snapshot_id?: string;
	chunk_manifest: ChunkManifest;
	findings: string[];
	trust_score: TrustScore;
	duration_seconds?: number;
}

export type SnapshotQueryType = 'by_id' | 'latest_for_branch' | 'by_commit' | 'by_date_range' | 'provenance_chain';

export interface SnapshotQueryParams {
	project_path: string;
	query_type: SnapshotQueryType;
	snapshot_id?: string;
	branch?: string;
	commit?: string;
	start_date?: string;
	end_date?: string;
	include_findings?: boolean;
	limit?: number;
}

// =============================================================================
// DELTA TYPES
// =============================================================================

export interface DeltaManifest {
	baseline_snapshot_id: string;
	target_commit: string;
	changed_files: Array<{
		path: string;
		change_type: 'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED';
		hunks: Array<{ start: number; count: number }>;
	}>;
	affected_chunks: string[];
	cascade_affected: string[];
	semantic_affected: string[];
	recommendation: 'INCREMENTAL' | 'FULL' | 'NO_CHANGES';
	estimated_savings: string;
}

export interface DeltaComputeParams {
	project: string;
	baseline_snapshot_id: string;
	target_commit?: string;
	cascade_depth?: number;
	enable_semantic_ripple?: boolean;
	similarity_threshold?: number;
}

// =============================================================================
// GRAPH TYPES
// =============================================================================

export type GraphNodeType = 'CODE' | 'FINDING' | 'SEMANTIC' | 'CHUNK';
export type GraphEdgeType = 'IMPORTS' | 'EVIDENCES' | 'BELONGS_TO' | 'SIMILAR_TO' | 'CONTAINS' | 'CALLS' | 'EXTENDS' | 'IMPLEMENTS';
export type GraphOperation = 'add_node' | 'update_node' | 'remove_node' | 'add_edge' | 'remove_edge' | 'bulk_update';

export interface GraphNode {
	node_id: string;
	node_type: GraphNodeType;
	properties: Record<string, any>;
}

export interface GraphEdge {
	source: string;
	target: string;
	edge_type: GraphEdgeType;
	weight?: number;
	symbols?: string[];
	confidence?: number;
	primary?: boolean;
}

export interface GraphUpdateParams {
	project_path: string;
	operation: GraphOperation;
	node?: GraphNode;
	node_id?: string;
	edge?: GraphEdge;
	bulk_nodes?: GraphNode[];
	bulk_edges?: GraphEdge[];
	commit: string;
}

export interface GraphPropagateParams {
	project_path: string;
	dirty_chunks: string[];
	max_depth?: number;
	edge_types?: GraphEdgeType[];
	min_edge_weight?: number;
	enable_semantic_ripple?: boolean;
	similarity_threshold?: number;
}

export interface CascadeChain {
	source_chunk: string;
	affected_chunk: string;
	path: string[];
	edge_types: string[];
	depth: number;
}

// =============================================================================
// FINDING RELOCATION TYPES
// =============================================================================

export type RelocationStatus = 'PRESERVED' | 'RELOCATED' | 'STALE' | 'ORPHANED';
export type RelocationMethod = 'EXACT_MATCH' | 'LINE_DRIFT' | 'SEMANTIC_SAME_FILE' | 'SEMANTIC_OTHER_FILE' | 'HASH_GLOBAL_SEARCH' | 'FUZZY_CONTEXT' | 'FILE_DELETED' | 'CONTENT_CHANGED';
export type RelocationStrategy = 'EXACT' | 'DRIFT' | 'SEMANTIC' | 'HASH_GLOBAL' | 'FUZZY';

export interface FindingLocation {
	file_path: string;
	line_start: number;
	line_end: number;
}

export interface FindingRelocateParams {
	finding_id: string;
	target_commit: string;
	project_path: string;
	strategies?: RelocationStrategy[];
	min_confidence?: number;
	delta_manifest?: DeltaManifest;
}

export interface RelocationResult {
	status: RelocationStatus;
	new_location?: FindingLocation;
	method: RelocationMethod;
	confidence: number;
	drift?: number;
	strategies_tried: Array<{ strategy: string; result: string; confidence?: number }>;
}

// =============================================================================
// BRANCH MANAGEMENT TYPES
// =============================================================================

export type BranchOperation = 'create' | 'get' | 'list' | 'delete' | 'rebase' | 'merge_to_main';

export interface AnalysisBranch {
	branch_id: string;
	git_branch: string;
	base_git_branch: string;
	fork_point_commit: string;
	snapshots: string[];
	created_at: string;
	updated_at: string;
}

export interface BranchManageParams {
	project_path: string;
	operation: BranchOperation;
	git_branch?: string;
	base_git_branch?: string;
	analysis_branch_id?: string;
	new_base_snapshot_id?: string;
}

// =============================================================================
// SNAPSHOT MERGE TYPES
// =============================================================================

export type ConflictStrategy = 'PREFER_NEW' | 'PREFER_BASELINE' | 'KEEP_BOTH';

export interface SnapshotMergeParams {
	baseline_snapshot_id: string;
	delta_envelope_ids: string[];
	relocation_results: Record<string, RelocationResult>;
	target_commit: string;
	project_path: string;
	conflict_strategy?: ConflictStrategy;
	workflow_id: string;
	workflow_goal: WorkflowGoal;
}

export interface MergeResult {
	snapshot_id: string;
	findings_preserved: number;
	findings_relocated: number;
	findings_new: number;
	findings_stale: number;
	findings_orphaned: number;
	conflicts_resolved: number;
	trust_score: TrustScore;
}

// =============================================================================
// COLLECTION NAMES
// =============================================================================

export const INCREMENTAL_COLLECTIONS = {
	ENVELOPES: 'cipher_envelopes',
	SNAPSHOTS: 'cipher_snapshots',
	IMPACT_GRAPH: 'cipher_impact_graph',
	BRANCHES: 'cipher_analysis_branches',
} as const;
