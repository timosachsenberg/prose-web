// The types of the OpenMS module (part B), re-exported from the declarations generated with the package
// (`public/openms/openms.d.ts`), so that the app follows the package it ships. Type-only: the module
// itself is loaded at run time by the engine worker (`worker.ts`), from the URL of the package.

import type { ProSEFileSummary, ProSEMultiSummary } from '../../../public/openms/openms'

export type {
  AnnotationOptions,
  MainModule,
  MemoryInfo,
  ParamEntry,
  ParamValue,
  PeakAnnotationResult,
  PeakMatch,
  PredictedIon,
  ProSEAlgorithm,
  ProSEFilesOptions,
  ProSEFileSummary,
  ProSEMultiSummary,
  ProSEResultSet,
  ProSESummary,
  ResultTables,
  StoredSpectra,
  ThreadingInfo,
} from '../../../public/openms/openms'

/** The aggregate modification analysis of a search (open searches; `null` otherwise). */
export type ModificationAnalysis = ProSEMultiSummary['modificationAnalysis']

/** The exit code of the search of one file (`'EXECUTION_OK'`, ...). */
export type ProSEFileStatus = ProSEFileSummary['status']
