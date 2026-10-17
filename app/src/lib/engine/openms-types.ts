// The types of the OpenMS module (part B), from the declarations generated with the package
// (`public/openms/openms.d.ts`), so that the app follows the package it ships. This is the one place
// that names the package. Type-only: the module itself is loaded at run time by the engine worker
// (`worker.ts`), from the URL of the package.

import type * as Package from '../../../public/openms/openms'

/** The default export of `openms.mjs`, which creates a module. */
export type OpenMSFactory = typeof Package.default

export type AnnotationOptions = Package.AnnotationOptions
export type MainModule = Package.MainModule
export type MemoryInfo = Package.MemoryInfo
export type ParamEntry = Package.ParamEntry
export type ParamValue = Package.ParamValue
export type PeakAnnotationResult = Package.PeakAnnotationResult
export type PeakMatch = Package.PeakMatch
export type PredictedIon = Package.PredictedIon
export type ProSEAlgorithm = Package.ProSEAlgorithm
export type ProSEFilesOptions = Package.ProSEFilesOptions
export type ProSEFileSummary = Package.ProSEFileSummary
export type ProSEMultiSummary = Package.ProSEMultiSummary
export type ProSEResultSet = Package.ProSEResultSet
export type ProSESummary = Package.ProSESummary
export type ResultTables = Package.ResultTables
export type StoredSpectra = Package.StoredSpectra
export type ThreadingInfo = Package.ThreadingInfo

/** The aggregate modification analysis of a search (open searches; `null` otherwise). */
export type ModificationAnalysis = ProSEMultiSummary['modificationAnalysis']

/** The exit code of the search of one file (`'EXECUTION_OK'`, ...). */
export type ProSEFileStatus = ProSEFileSummary['status']
