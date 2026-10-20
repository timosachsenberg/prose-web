// An error of a search for people: where it happened (the stage and file of the last progress report)
// and what happened, with OpenMS' own text as a secondary detail.

export type FailureStage = {
  /** The last progress label ("Searching broken.mzML (2 of 2)..."). */
  label: string
  /** The input file of the last progress report; -1 outside the files. */
  file: number
  /** The names of the files of the search, in request order. */
  files: string[]
  /** How long no progress had been reported when the error came (ms). */
  silentMs: number
}

export type Failure = {
  /** "While searching file 2 of 2 (broken.mzML)" */
  context: string
  /** What happened, in one or two sentences. */
  summary: string
  /** OpenMS' raw text, when the summary shortens it. */
  detail: string | null
}

/** Without a report for this long, the engine was in a step that reports no progress (Percolator). */
export const SILENT_MS = 2000

const steps: [RegExp, string][] = [
  [/^Starting OpenMS/, 'While starting OpenMS'],
  [/^Reading the files/, 'While reading the files'],
  [/^Loading the PeptDeep models/, 'While loading the PeptDeep models'],
  [/^Reading the spectra of the PSMs/, 'While reading the spectra of the PSMs'],
]

/**
 * Errors whose stage the message itself tells, whatever the last progress report was. Percolator
 * reports no progress, and its partial-rescoring check comes after the steps of all files.
 */
const messageStages: [RegExp, string][] = [[/^Percolator could rescore only some of the files/, 'While rescoring with Percolator']]

// OpenMS' exceptions read "<message> - due to that error of type <Name> in: <source>@<line>-<function>",
// or "<message> in: <source>@<line>-<function>", where the location may also be empty
const DUE_TO = / - due to that error of type /
const LOCATION = /\s+in:\s*(?:\S+@\d+-[^]*)?$/

function stageOf(stage: FailureStage, message: string): string {
  const known = messageStages.find(([pattern]) => pattern.test(message))
  if (known) return known[1]
  const n = stage.files.length
  if (stage.file >= 0 && stage.file < n) {
    const file = n === 1 ? stage.files[0] : `file ${stage.file + 1} of ${n} (${stage.files[stage.file]})`
    // the file's step was running, but in a part that reports nothing: its last label would mislead
    const silent = stage.silentMs > SILENT_MS ? ', in a step without progress reports (e.g. Percolator)' : ''
    return `While searching ${file}${silent}`
  }
  const label = stage.label.trim().replace(/(\.\.\.|…)$/, '')
  // the count of the database's proteins, which a search started during it waits for
  if (/^Counting proteins/.test(label)) {
    const database = /^(.+?) cannot be read \(/.exec(message)?.[1]
    return database ? `While counting the proteins of ${database}` : 'While counting the proteins'
  }
  return steps.find(([pattern]) => pattern.test(label))?.[1] ?? (label ? `During “${label}”` : 'During the search')
}

/** OpenMS' exception text without its type and source location; null if it is not one. */
function exceptionText(message: string): string | null {
  const due = message.search(DUE_TO)
  if (due >= 0) return message.slice(0, due)
  const location = LOCATION.exec(message)
  return location ? message.slice(0, location.index) : null
}

export function describeFailure(stage: FailureStage, message: string): Failure {
  const context = stageOf(stage, message)
  const raw = exceptionText(message)
  if (raw === null) return { context, summary: message, detail: null }
  let text = raw.trim().replace(/:$/, '')
  if (!/[.!?]$/.test(text)) text += '.'
  const hint = /parse error/i.test(text) && !/fasta/i.test(text) ? ' The file may be incomplete or not valid mzML.' : ''
  return { context, summary: `${text}${hint}`, detail: message }
}
