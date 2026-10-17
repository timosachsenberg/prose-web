// An error of a search for people: where it happened (the stage and file of the last progress report)
// and what happened, with OpenMS' own text as a secondary detail.

export type FailureStage = {
  /** The last progress label ("Searching broken.mzML (2 of 2)..."). */
  label: string
  /** The input file of the last progress report; -1 outside the files. */
  file: number
  /** The names of the files of the search, in request order. */
  files: string[]
}

export type Failure = {
  /** "While searching file 2 of 2 (broken.mzML)" */
  context: string
  /** What happened, in one or two sentences. */
  summary: string
  /** OpenMS' raw text, when the summary shortens it. */
  detail: string | null
}

const steps: [RegExp, string][] = [
  [/^Starting OpenMS/, 'While starting OpenMS'],
  [/^Reading the files/, 'While reading the files'],
  [/^Loading the PeptDeep models/, 'While loading the PeptDeep models'],
  [/^Reading the spectra of the PSMs/, 'While reading the spectra of the PSMs'],
]

// OpenMS' exceptions read "<message> - due to that error of type <Name> in: <source>@<line>-<function>"
const OPENMS_EXCEPTION = / - due to that error of type .* in: /s

export function describeFailure(stage: FailureStage, message: string): Failure {
  const label = stage.label.trim().replace(/(\.\.\.|…)$/, '')
  const n = stage.files.length
  let context: string
  if (stage.file >= 0 && stage.file < n) {
    context = n === 1 ? `While searching ${stage.files[0]}` : `While searching file ${stage.file + 1} of ${n} (${stage.files[stage.file]})`
  } else {
    context = steps.find(([pattern]) => pattern.test(label))?.[1] ?? (label ? `During “${label}”` : 'During the search')
  }

  const exception = OPENMS_EXCEPTION.exec(message)
  if (!exception) return { context, summary: message, detail: null }
  const text = message.slice(0, exception.index).trim().replace(/:$/, '')
  const hint = /parse error/i.test(text) ? ' The file may be incomplete or not valid mzML.' : ''
  return { context, summary: `${text}.${hint}`, detail: message }
}
