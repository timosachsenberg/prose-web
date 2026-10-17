// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
declare var RuntimeExports: {
    FS: {
        ErrnoError: {
            new (code: any): {
                name: string;
                message: string;
                errno: any;
                stack?: string;
                cause?: unknown;
            };
        };
        handleError(returnValue: any): any;
        createDataFile(parent: any, name: any, fileData: any, canRead: any, canWrite: any, canOwn: any): void;
        createPath(parent: any, path: any, canRead: any, canWrite: any): any;
        createPreloadedFile(parent: any, name: any, url: any, canRead: any, canWrite: any, onload: any, onerror: any, dontCreateFile: any, canOwn: any, preFinish: any): any;
        preloadFile(parent: any, name: any, url: any, canRead: any, canWrite: any, dontCreateFile: any, canOwn: any, preFinish: any): Promise<any>;
        readFile(path: any, opts?: {}): any;
        cwd: () => any;
        mkdir: (path: any, mode: any) => any;
        mkdirTree: (path: any, mode: any) => any;
        rmdir: (path: any) => any;
        open: (path: any, flags: any, mode?: number) => any;
        create: (path: any, mode: any) => any;
        close: (stream: any) => any;
        unlink: (path: any) => any;
        chdir: (path: any) => any;
        read(stream: any, buffer: any, offset: any, length: any, position: any): any;
        write(stream: any, buffer: any, offset: any, length: any, position: any, canOwn: any): any;
        writeFile: (path: any, data: any) => any;
        mmap: (stream: any, length: any, offset: any, prot: any, flags: any) => {
            ptr: any;
            allocated: boolean;
        };
        msync: (stream: any, bufferPtr: any, offset: any, length: any, mmapFlags: any) => any;
        munmap: (addr: any, length: any) => any;
        symlink: (target: any, linkpath: any) => any;
        readlink(path: any): any;
        statBufToObject(statBuf: any): {
            dev: any;
            mode: any;
            nlink: any;
            uid: any;
            gid: any;
            rdev: any;
            size: any;
            blksize: any;
            blocks: any;
            atime: any;
            mtime: any;
            ctime: any;
            ino: any;
        };
        stat(path: any): any;
        lstat(path: any): any;
        chmod(path: any, mode: any): any;
        lchmod(path: any, mode: any): any;
        fchmod(fd: any, mode: any): any;
        utime: (path: any, atime: any, mtime: any) => any;
        truncate(path: any, len: any): any;
        ftruncate(fd: any, len: any): any;
        readdir: (path: any) => any;
        mount: (type: any, opts: any, mountpoint: any) => any;
        unmount: (mountpoint: any) => any;
        mknod: (path: any, mode: any, dev: any) => any;
        makedev: (ma: any, mi: any) => number;
        registerDevice(dev: any, ops: any): void;
        createDevice(parent: any, name: any, input: any, output: any): any;
        mkdev(path: any, mode: any, dev: any): any;
        rename(oldPath: any, newPath: any): any;
        llseek(stream: any, offset: any, whence: any): any;
    };
    ENV: {};
    FS_createPath: any;
    FS_createDataFile: (parent: any, name: any, fileData: any, canRead: any, canWrite: any, canOwn: any) => void;
    FS_preloadFile: (parent: any, name: any, url: any, canRead: any, canWrite: any, dontCreateFile: any, canOwn: any, preFinish: any) => Promise<void>;
    FS_unlink: (path: any) => any;
    addRunDependency: (id: any) => void;
    removeRunDependency: (id: any) => void;
};
interface WasmModule {
  __ZdlPvm(_0: number, _1: number): void;
  __Znwm(_0: number): number;
  __ZdlPv(_0: number): void;
  __Znam(_0: number): number;
  __ZdaPv(_0: number): void;
  __ZnwmSt11align_val_t(_0: number, _1: number): number;
  __ZdaPvm(_0: number, _1: number): void;
  _emscripten_builtin_free(_0: number): void;
  _emscripten_builtin_malloc(_0: number): number;
  ___libc_free(_0: number): void;
  ___libc_malloc(_0: number): number;
  _strndup(_0: number, _1: number): number;
  __ZnamSt11align_val_t(_0: number, _1: number): number;
  ___libc_calloc(_0: number, _1: number): number;
  ___libc_realloc(_0: number, _1: number): number;
  _emscripten_builtin_calloc(_0: number, _1: number): number;
  _emscripten_builtin_realloc(_0: number, _1: number): number;
  _malloc_size(_0: number): number;
  _malloc_usable_size(_0: number): number;
  _reallocf(_0: number, _1: number): number;
}

type EmbindString = ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string;
export interface ClassHandle {
  isAliasOf(other: ClassHandle): boolean;
  delete(): void;
  deleteLater(): this;
  isDeleted(): boolean;
  // @ts-ignore - If targeting lower than ESNext, this symbol might not exist.
  [Symbol.dispose](): void;
  clone(): this;
}
export interface ResidueTypeValue<T extends number> {
  value: T;
}
export type ResidueType = ResidueTypeValue<0>|ResidueTypeValue<1>|ResidueTypeValue<2>|ResidueTypeValue<3>|ResidueTypeValue<4>|ResidueTypeValue<5>|ResidueTypeValue<6>|ResidueTypeValue<7>|ResidueTypeValue<8>|ResidueTypeValue<9>|ResidueTypeValue<10>|ResidueTypeValue<11>|ResidueTypeValue<12>;

export interface AASequence extends ClassHandle {
  toString(): string;
  toUnmodifiedString(): string;
  toUniModString(): string;
  size(): number;
  empty(): boolean;
  equals(_0: AASequence): boolean;
  getMonoWeight(): number;
  getMonoWeight(_0: ResidueType, _1: number): number;
  getAverageWeight(): number;
  getAverageWeight(_0: ResidueType, _1: number): number;
  getMZ(_0: number): number;
  getMZ(_0: number, _1: ResidueType): number;
  getPrefix(_0: number): AASequence;
  getSuffix(_0: number): AASequence;
  getSubsequence(_0: number, _1: number): AASequence;
  isModified(): boolean;
  hasNTerminalModification(): boolean;
  hasCTerminalModification(): boolean;
  getNTerminalModificationName(): string;
  getCTerminalModificationName(): string;
  setModification(_0: number, _1: EmbindString): void;
  setNTerminalModification(_0: EmbindString): void;
  setCTerminalModification(_0: EmbindString): void;
  hasSubsequence(_0: AASequence): boolean;
  hasPrefix(_0: AASequence): boolean;
  hasSuffix(_0: AASequence): boolean;
  getFormula(): EmpiricalFormula;
  getFormula(_0: ResidueType, _1: number): EmpiricalFormula;
  getResidue(_0: number): Residue;
  getResidues(): Residue[];
  getAAFrequencies(): Record<string, number>;
}

export interface EmpiricalFormula extends ClassHandle {
  toString(): string;
  getMonoWeight(): number;
  getAverageWeight(): number;
  getCharge(): number;
  setCharge(_0: number): void;
  getNumberOfAtoms(): number;
  isEmpty(): boolean;
  isCharged(): boolean;
  contains(_0: EmpiricalFormula): boolean;
  equals(_0: EmpiricalFormula): boolean;
  plus(_0: EmpiricalFormula): EmpiricalFormula;
  minus(_0: EmpiricalFormula): EmpiricalFormula;
  getIsotopeDistribution(_0: IsotopePatternGenerator): IsotopeDistribution;
  toObject(): Record<string, number>;
}

export interface IsotopeDistribution extends ClassHandle {
  size(): number;
  getMin(): number;
  getMax(): number;
  averageMass(): number;
  renormalize(): void;
  merge(_0: number, _1: number): void;
  trimRight(_0: number): void;
  trimLeft(_0: number): void;
  trimIntensities(_0: number): void;
  sortByIntensity(): void;
  sortByMass(): void;
  clear(): void;
  getMostAbundant(): Peak | null;
  getPeaks(): IsotopePeaks;
  getContainer(): Peak[];
}

export interface IsotopePatternGenerator extends ClassHandle {
  run(_0: EmpiricalFormula): IsotopeDistribution;
}

export interface CoarseIsotopePatternGenerator extends IsotopePatternGenerator {
  getMaxIsotope(): number;
  setMaxIsotope(_0: number): void;
  getRoundMasses(): boolean;
  setRoundMasses(_0: boolean): void;
  estimateFromPeptideWeight(_0: number): IsotopeDistribution;
}

export interface FineIsotopePatternGenerator extends IsotopePatternGenerator {
  getThreshold(): number;
  setThreshold(_0: number): void;
  getAbsolute(): boolean;
  setAbsolute(_0: boolean): void;
  getTotalProbability(): boolean;
  setTotalProbability(_0: boolean): void;
}

export interface ResidueDB extends ClassHandle {
}

export interface ModificationsDB extends ClassHandle {
}

export interface ProteaseDB extends ClassHandle {
}

export interface ProteaseDigestion extends ClassHandle {
  setEnzyme(_0: EmbindString): void;
  getEnzymeName(): string;
  setMissedCleavages(_0: number): void;
  getMissedCleavages(): number;
  setSpecificity(_0: EmbindString): void;
  getSpecificity(): string;
  peptideCount(_0: AASequence): number;
  digestUnmodified(_0: EmbindString, _1: number, _2: number): string[];
  digest(_0: AASequence, _1: number, _2: number): AASequence[];
}

export interface Feature extends ClassHandle {
  getUniqueId(): string;
  getRT(): number;
  setRT(_0: number): void;
  getMZ(): number;
  setMZ(_0: number): void;
  getIntensity(): number;
  setIntensity(_0: number): void;
  getCharge(): number;
  setCharge(_0: number): void;
  getOverallQuality(): number;
  setOverallQuality(_0: number): void;
  getWidth(): number;
  setWidth(_0: number): void;
  encloses(_0: number, _1: number): boolean;
  getMetaValue(_0: EmbindString): MetaValue;
  setMetaValue(_0: EmbindString, _1: number | string | boolean | number[] | string[]): void;
  getMetaValues(): MetaValues;
  getBoundingBox(): BoundingBox | null;
  getMassTraceBoundingBoxes(): BoundingBox[];
  getConvexHullPoints(): [number, number][];
  toObject(): FeatureData;
}

export interface FeatureMap extends ClassHandle {
  size(): number;
  get(_0: number): Feature;
  set(_0: number, _1: Feature): void;
  push_back(_0: Feature): void;
  clear(_0: boolean): void;
  sortByRT(): void;
  sortByMZ(): void;
  sortByPosition(): void;
  sortByIntensity(_0: boolean): void;
  sortByOverallQuality(_0: boolean): void;
  updateRanges(): void;
  getMinRT(): number;
  getMaxRT(): number;
  getMinMZ(): number;
  getMaxMZ(): number;
  getMinIntensity(): number;
  getMaxIntensity(): number;
  ensureUniqueIds(): void;
  getUnassignedPeptideIdentifications(): PeptideIdentificationList;
  setUnassignedPeptideIdentifications(_0: PeptideIdentificationList): void;
  getProteinIdentifications(): ProteinIdentificationList;
  setProteinIdentifications(_0: ProteinIdentificationList): void;
  getMetaValue(_0: EmbindString): MetaValue;
  setMetaValue(_0: EmbindString, _1: number | string | boolean | number[] | string[]): void;
  getMetaValues(): MetaValues;
  toArray(): FeatureData[];
  getFeatureTable(): FeatureTable;
}

export interface ConsensusMap extends ClassHandle {
  size(): number;
  getExperimentType(): string;
  updateRanges(): void;
  sortByRT(): void;
  sortByMZ(): void;
  get(_0: number): ConsensusFeatureData;
  toArray(): ConsensusFeatureData[];
  getColumnHeaders(): { index: number; filename: string; label: string; size: number }[];
}

export interface MassTraceList extends ClassHandle {
  size(): number;
  clear(): void;
  toArray(): { label: string; mz: number; rt: number; mzSD: number; intensity: number; maxIntensity: number; fwhm: number; traceLength: number; size: number }[];
}

export interface MzMLFile extends ClassHandle {
  load(_0: EmbindString, _1: MSExperiment): void;
  store(_0: EmbindString, _1: MSExperiment): void;
  loadBuffer(_0: EmbindString, _1: MSExperiment): void;
  storeBuffer(_0: MSExperiment): string;
  getOptions(): PeakFileOptions;
  setOptions(_0: PeakFileOptions): void;
}

export interface MzXMLFile extends ClassHandle {
  load(_0: EmbindString, _1: MSExperiment): void;
  store(_0: EmbindString, _1: MSExperiment): void;
}

export interface FeatureXMLFile extends ClassHandle {
  load(_0: EmbindString, _1: FeatureMap): void;
  store(_0: EmbindString, _1: FeatureMap): void;
}

export interface ConsensusXMLFile extends ClassHandle {
  load(_0: EmbindString, _1: ConsensusMap): void;
  store(_0: EmbindString, _1: ConsensusMap): void;
}

export interface IdXMLFile extends ClassHandle {
  load(_0: EmbindString, _1: ProteinIdentificationList, _2: PeptideIdentificationList): void;
  store(_0: EmbindString, _1: ProteinIdentificationList, _2: PeptideIdentificationList): void;
}

export interface MzIdentMLFile extends ClassHandle {
  load(_0: EmbindString, _1: ProteinIdentificationList, _2: PeptideIdentificationList): void;
  store(_0: EmbindString, _1: ProteinIdentificationList, _2: PeptideIdentificationList): void;
}

export interface FASTAFile extends ClassHandle {
  load(_0: EmbindString): { identifier: string; description?: string; sequence: string }[];
  store(_0: EmbindString, _1: { identifier: string; description?: string; sequence: string }[]): void;
}

export interface FileHandler extends ClassHandle {
  loadFeatures(_0: EmbindString, _1: FeatureMap): void;
  storeFeatures(_0: EmbindString, _1: FeatureMap): void;
  loadConsensusFeatures(_0: EmbindString, _1: ConsensusMap): void;
  storeConsensusFeatures(_0: EmbindString, _1: ConsensusMap): void;
  loadIdentifications(_0: EmbindString, _1: ProteinIdentificationList, _2: PeptideIdentificationList): void;
  storeIdentifications(_0: EmbindString, _1: ProteinIdentificationList, _2: PeptideIdentificationList): void;
  loadExperiment(_0: EmbindString, _1: MSExperiment): void;
  storeExperiment(_0: EmbindString, _1: MSExperiment): void;
  getOptions(): PeakFileOptions;
  setOptions(_0: PeakFileOptions): void;
}

export interface PeptideHit extends ClassHandle {
  getSequence(): AASequence;
  setSequence(_0: AASequence): void;
  getSequenceString(): string;
  setSequenceString(_0: EmbindString): void;
  getScore(): number;
  setScore(_0: number): void;
  getCharge(): number;
  setCharge(_0: number): void;
  getRank(): number;
  setRank(_0: number): void;
  isDecoy(): boolean;
  getProteinAccessions(): string[];
  getMetaValue(_0: EmbindString): MetaValue;
  setMetaValue(_0: EmbindString, _1: number | string | boolean | number[] | string[]): void;
  getMetaValues(): MetaValues;
  toObject(): PeptideHitData;
  getPeakAnnotations(): { mz: number; intensity: number; annotation: string; charge: number }[];
}

export interface PeptideIdentification extends ClassHandle {
  getRT(): number;
  setRT(_0: number): void;
  hasRT(): boolean;
  getMZ(): number;
  setMZ(_0: number): void;
  hasMZ(): boolean;
  insertHit(_0: PeptideHit): void;
  getHitCount(): number;
  getScoreType(): string;
  setScoreType(_0: EmbindString): void;
  isHigherScoreBetter(): boolean;
  setHigherScoreBetter(_0: boolean): void;
  getIdentifier(): string;
  setIdentifier(_0: EmbindString): void;
  getSpectrumReference(): string;
  setSpectrumReference(_0: EmbindString): void;
  sort(): void;
  getMetaValue(_0: EmbindString): MetaValue;
  setMetaValue(_0: EmbindString, _1: number | string | boolean | number[] | string[]): void;
  getMetaValues(): MetaValues;
  toObject(): PeptideIdentificationData;
  getHits(): PeptideHit[];
  setHits(_0: PeptideHit[]): void;
}

export interface PeptideIdentificationList extends ClassHandle {
  size(): number;
  get(_0: number): PeptideIdentification;
  set(_0: number, _1: PeptideIdentification): void;
  push_back(_0: PeptideIdentification): void;
  clear(): void;
  toArray(): PeptideIdentificationData[];
}

export interface ProteinHit extends ClassHandle {
  getAccession(): string;
  setAccession(_0: EmbindString): void;
  getScore(): number;
  setScore(_0: number): void;
  getSequence(): string;
  setSequence(_0: EmbindString): void;
  getDescription(): string;
  setDescription(_0: EmbindString): void;
  getCoverage(): number;
  setCoverage(_0: number): void;
  getMetaValue(_0: EmbindString): MetaValue;
  setMetaValue(_0: EmbindString, _1: number | string | boolean | number[] | string[]): void;
  getMetaValues(): MetaValues;
  toObject(): ProteinHitData;
}

export interface ProteinIdentification extends ClassHandle {
  insertHit(_0: ProteinHit): void;
  getHitCount(): number;
  getIdentifier(): string;
  setIdentifier(_0: EmbindString): void;
  getSearchEngine(): string;
  setSearchEngine(_0: EmbindString): void;
  getSearchEngineVersion(): string;
  getScoreType(): string;
  setScoreType(_0: EmbindString): void;
  isHigherScoreBetter(): boolean;
  setHigherScoreBetter(_0: boolean): void;
  getMetaValue(_0: EmbindString): MetaValue;
  setMetaValue(_0: EmbindString, _1: number | string | boolean | number[] | string[]): void;
  getMetaValues(): MetaValues;
  toObject(): ProteinIdentificationData;
  getHits(): ProteinHit[];
  setHits(_0: ProteinHit[]): void;
}

export interface ProteinIdentificationList extends ClassHandle {
  size(): number;
  get(_0: number): ProteinIdentification;
  set(_0: number, _1: ProteinIdentification): void;
  push_back(_0: ProteinIdentification): void;
  clear(): void;
  toArray(): ProteinIdentificationData[];
}

export interface MSSpectrum extends ClassHandle {
  size(): number;
  empty(): boolean;
  clear(_0: boolean): void;
  getRT(): number;
  setRT(_0: number): void;
  getMSLevel(): number;
  setMSLevel(_0: number): void;
  getName(): string;
  setName(_0: EmbindString): void;
  getNativeID(): string;
  setNativeID(_0: EmbindString): void;
  getDriftTime(): number;
  setDriftTime(_0: number): void;
  getType(): string;
  setType(_0: EmbindString): void;
  guessType(): string;
  getPolarity(): string;
  setPolarity(_0: EmbindString): void;
  addPeak(_0: number, _1: number): void;
  sortByPosition(): void;
  sortByIntensity(_0: boolean): void;
  isSorted(): boolean;
  findNearest(_0: number): number;
  findNearest(_0: number, _1: number): number;
  calculateTIC(): number;
  metaValueExists(_0: EmbindString): boolean;
  setPeaks(_0: ArrayLike<number>, _1: ArrayLike<number>): void;
  getMetaValueKeys(): string[];
  getMetaValue(_0: EmbindString): MetaValue;
  setMetaValue(_0: EmbindString, _1: number | string | boolean | number[] | string[]): void;
  getMetaValues(): MetaValues;
  getPeaks(): SpectrumPeaks;
  getPeak(_0: number): Peak;
  getBasePeak(): { index: number; mz: number; intensity: number } | null;
  getPrecursors(): Precursor[];
  setPrecursors(_0: Partial<Precursor>[]): void;
  getProducts(): Product[];
  getFloatDataArrays(): { name: string; data: Float32Array }[];
  getIntegerDataArrays(): { name: string; data: Int32Array }[];
  getStringDataArrays(): { name: string; data: string[] }[];
}

export interface MSChromatogram extends ClassHandle {
  size(): number;
  empty(): boolean;
  clear(_0: boolean): void;
  getName(): string;
  setName(_0: EmbindString): void;
  getNativeID(): string;
  setNativeID(_0: EmbindString): void;
  getMZ(): number;
  getChromatogramType(): string;
  addPeak(_0: number, _1: number): void;
  sortByPosition(): void;
  isSorted(): boolean;
  calculateTIC(): number;
  setPeaks(_0: ArrayLike<number>, _1: ArrayLike<number>): void;
  getMetaValueKeys(): string[];
  getMetaValue(_0: EmbindString): MetaValue;
  setMetaValue(_0: EmbindString, _1: number | string | boolean | number[] | string[]): void;
  getMetaValues(): MetaValues;
  getPeaks(): ChromatogramPeaks;
  getPrecursor(): Precursor;
  setPrecursor(_0: Partial<Precursor>): void;
  getProduct(): Product;
  getFloatDataArrays(): { name: string; data: Float32Array }[];
}

export interface MSExperiment extends ClassHandle {
  size(): number;
  empty(): boolean;
  getNrSpectra(): number;
  getNrChromatograms(): number;
  getNrPeaks(): number;
  getSpectrum(_0: number): MSSpectrum;
  setSpectrum(_0: number, _1: MSSpectrum): void;
  addSpectrum(_0: MSSpectrum): void;
  getChromatogram(_0: number): MSChromatogram;
  setChromatogram(_0: number, _1: MSChromatogram): void;
  addChromatogram(_0: MSChromatogram): void;
  updateRanges(): void;
  getMinRT(): number;
  getMaxRT(): number;
  getMinMZ(): number;
  getMaxMZ(): number;
  getMinIntensity(): number;
  getMaxIntensity(): number;
  sortSpectra(_0: boolean): void;
  sortChromatograms(_0: boolean): void;
  isSorted(_0: boolean): boolean;
  clear(_0: boolean): void;
  calculateTIC(_0: number, _1: number): MSChromatogram;
  getClosestSpectrumInRT(_0: number, _1: number): number;
  getPrecursorSpectrum(_0: number): number;
  getFirstProductSpectrum(_0: number): number;
  getMSLevels(): number[];
  getSpectrumSummary(): { index: number; nativeID: string; rt: number; msLevel: number; size: number; tic: number; basePeakMZ?: number; basePeakIntensity?: number; minMZ?: number; maxMZ?: number; precursorMZ?: number; precursorCharge?: number }[];
  get2DPeakData(_0: number, _1: number, _2: number, _3: number, _4: number): PeakData2D;
}

export interface Param extends ClassHandle {
  exists(_0: EmbindString): boolean;
  remove(_0: EmbindString): void;
  size(): number;
  empty(): boolean;
  clear(): void;
  getDescription(_0: EmbindString): string;
  copy(_0: EmbindString, _1: boolean): Param;
  insert(_0: EmbindString, _1: Param): void;
  keys(): string[];
  getTags(_0: EmbindString): string[];
  getValue(_0: EmbindString): ParamValue;
  setValue(_0: EmbindString, _1: ParamValue): void;
  setValue(_0: EmbindString, _1: ParamValue, _2: EmbindString): void;
  toObject(): ParamValues;
  update(_0: ParamValues): void;
  getEntry(_0: EmbindString): ParamEntry;
  getEntries(): ParamEntry[];
}

export interface DefaultParamHandler extends ClassHandle {
  getName(): string;
  getParameters(): Param;
  setParameters(_0: Param): void;
  getDefaults(): Param;
  getParameterValues(): ParamValues;
  setParameterValues(_0: ParamValues): void;
}

export interface TheoreticalSpectrumGenerator extends DefaultParamHandler {
  getSpectrum(_0: MSSpectrum, _1: AASequence, _2: number, _3: number): void;
  getSpectrum(_0: MSSpectrum, _1: AASequence, _2: number, _3: number, _4: number): void;
}

export interface MassTraceDetection extends DefaultParamHandler {
  run(_0: MSExperiment, _1: MassTraceList): void;
  run(_0: MSExperiment, _1: MassTraceList, _2: number): void;
}

export interface ElutionPeakDetection extends DefaultParamHandler {
  detectPeaks(_0: MassTraceList, _1: MassTraceList): void;
}

export interface FeatureFindingMetabo extends DefaultParamHandler {
  run(_0: MassTraceList, _1: FeatureMap): void;
}

export interface MascotGenericFile extends DefaultParamHandler {
  load(_0: EmbindString, _1: MSExperiment): void;
  store(_0: EmbindString, _1: MSExperiment): void;
  store(_0: EmbindString, _1: MSExperiment, _2: boolean): void;
}

export interface SimpleSearchEngineAlgorithm extends DefaultParamHandler {
  search(_0: EmbindString, _1: EmbindString, _2: ProteinIdentificationList, _3: PeptideIdentificationList): string;
}

export interface PeakPickerHiRes extends DefaultParamHandler {
  pick(_0: MSSpectrum, _1: MSSpectrum): void;
  pickChromatogram(_0: MSChromatogram, _1: MSChromatogram): void;
  pickExperiment(_0: MSExperiment, _1: MSExperiment): void;
  pickExperiment(_0: MSExperiment, _1: MSExperiment, _2: boolean): void;
}

export interface GaussFilter extends DefaultParamHandler {
  filter(_0: MSSpectrum): void;
  filterChromatogram(_0: MSChromatogram): void;
  filterExperiment(_0: MSExperiment): void;
}

export interface SavitzkyGolayFilter extends DefaultParamHandler {
  filter(_0: MSSpectrum): void;
  filterChromatogram(_0: MSChromatogram): void;
  filterExperiment(_0: MSExperiment): void;
}

export interface Normalizer extends DefaultParamHandler {
  filterPeakSpectrum(_0: MSSpectrum): void;
  filterPeakMap(_0: MSExperiment): void;
}

export interface ThresholdMower extends DefaultParamHandler {
  filterPeakSpectrum(_0: MSSpectrum): void;
  filterPeakMap(_0: MSExperiment): void;
}

export interface WindowMower extends DefaultParamHandler {
  filterPeakSpectrum(_0: MSSpectrum): void;
  filterPeakMap(_0: MSExperiment): void;
}

export interface NLargest extends DefaultParamHandler {
  filterPeakSpectrum(_0: MSSpectrum): void;
  filterPeakMap(_0: MSExperiment): void;
}

export interface SpectrumAlignment extends DefaultParamHandler {
  getSpectrumAlignment(_0: MSSpectrum, _1: MSSpectrum): [number, number][];
}

export interface SpectrumAlignmentScore extends DefaultParamHandler {
  score(_0: MSSpectrum, _1: MSSpectrum): number;
}

export interface ProSEResultSet extends ClassHandle {
  storeIdXML(_0: EmbindString): void;
  _debugSetNativeId(_0: number, _1: EmbindString): void;
  summary(): ProSEMultiSummary;
  tables(): ResultTables;
  spectra(): StoredSpectra;
}

export interface ProSEAlgorithm extends DefaultParamHandler {
  annotatePsmQValues(_0: PeptideIdentificationList): void;
  searchFiles(_0: string[], _1: EmbindString): ProSEResultSet;
  setProgressCallback(_0: ((progress: { event: 'start' | 'progress' | 'end'; label: string; depth: number; begin: number; end: number; value: number; /** position of the input file being searched (its step 'Searching <name> (<i> of <n>)...': i - 1), -1 outside a file */ file: number }) => void) | null | undefined): void;
  search(_0: EmbindString, _1: EmbindString, _2: ProteinIdentificationList, _3: PeptideIdentificationList): ProSESummary;
  search(_0: EmbindString, _1: EmbindString, _2: ProteinIdentificationList, _3: PeptideIdentificationList, _4: ProSEOptions): ProSESummary;
  searchFiles(_0: string[], _1: EmbindString, _2: ProSEFilesOptions): ProSEResultSet;
}

export type MetaValue = number | string | number[] | string[] | null | undefined;

export type MetaValues = Record<string, number | string | number[] | string[] | null>;

export type ParamValue = number | string | boolean | number[] | string[] | null;

export type ParamValues = Record<string, ParamValue>;

export type ParamEntry = { name: string; value: ParamValue; type: 'string' | 'int' | 'double' | 'bool' | 'string[]' | 'int[]' | 'double[]' | 'empty'; description: string; tags: string[]; validStrings?: string[]; min?: number; max?: number };

export type SpectrumPeaks = { mz: Float64Array; intensity: Float32Array };

export type ChromatogramPeaks = { rt: Float64Array; intensity: Float32Array };

export type Peak = { mz: number; intensity: number };

export type Precursor = { mz: number; intensity: number; charge: number; isolationWindowLowerOffset: number; isolationWindowUpperOffset: number; activationEnergy: number; activationMethods: string[]; driftTime: number };

export type Product = { mz: number; isolationWindowLowerOffset: number; isolationWindowUpperOffset: number };

export type PeakData2D = { rt: Float64Array; mz: Float64Array; intensity: Float32Array };

export type Residue = { name: string; oneLetterCode: string; threeLetterCode: string; formula: string; monoWeight: number; averageWeight: number; isModified: boolean; modificationName: string | null };

export type Modification = { id: string; fullId: string; fullName: string; unimodAccession: string; psiModAccession: string; origin: string; termSpecificity: string; diffMonoMass: number; monoMass: number; diffFormula: string } | null;

export type Enzyme = { name: string; regEx: string; regExDescription: string; psiId: string };

export type IsotopePeaks = { mz: Float64Array; intensity: Float64Array };

export type ThreadingInfo = { threaded: boolean; available: boolean; numThreads: number };

export type MemoryInfo = { heapSize: number; heapMax: number };

export type PeakFileOptions = { msLevels?: number[]; rtRange?: [number, number]; mzRange?: [number, number]; intensityRange?: [number, number]; metadataOnly?: boolean; fillData?: boolean; sortSpectraByMZ?: boolean; skipXMLChecks?: boolean };

export type PeptideHitData = { sequence: string; score: number; charge: number; rank: number; isDecoy: boolean; proteinAccessions: string[]; metaValues: MetaValues };

export type PeptideIdentificationData = { rt: number | null; mz: number | null; scoreType: string; higherScoreBetter: boolean; identifier: string; spectrumReference: string; hits: PeptideHitData[]; metaValues: MetaValues };

export type ProteinHitData = { accession: string; score: number; description: string; sequence: string; coverage: number; metaValues: MetaValues };

export type ProteinIdentificationData = { identifier: string; searchEngine: string; searchEngineVersion: string; scoreType: string; higherScoreBetter: boolean; hits: ProteinHitData[]; metaValues: MetaValues };

export type ProSESummary = { status: 'EXECUTION_OK' | 'INPUT_FILE_EMPTY' | 'UNEXPECTED_RESULT' | 'ILLEGAL_PARAMETERS' | 'UNKNOWN_ERROR'; openSearch: boolean; haveDecoys: boolean; decoyString: string; decoyIsPrefix: boolean; proteinFDRApplied: boolean; percolator: { applied: boolean; skipped: string | null } | null; run: { inputFile: string; ms2Spectra: number; matchedSpectra: number; targetPSMs: number; decoyPSMs: number; fdrApplied: boolean; achievedPsmFDR: number | null; uniquePeptides: number; uniqueProteins: number; chargeHistogram: Record<string, number>; missedCleavageHistogram: Record<string, number>; hyperscore?: { min: number; median: number; max: number }; precursorError: { median: number; mad: number; recommended: number } | null; fragmentError: { median: number; mad: number; recommended: number } | null; secondsSearch: number; secondsCalibration: number; secondsFDR: number }; search: { databaseFile: string; enzyme: string; openSearch: boolean; calibration: boolean; chunked: boolean; decoyMode: string; targetProteins: number; decoyProteins: number; indexedPeptides: number; indexedFragments: number; secondsIndexBuild: number; secondsTotal: number }; modificationAnalysis: { deltaMasses: { totalPSMs: number; modifiedPSMs: number; unmodifiedPSMs: number; meanDeltaMass: number; medianDeltaMass: number; entries: { deltaMass: number; count: number; uniquePeptides: number; chargeStates: number; percentage: number; modification: string; known: boolean }[] }; ptms: { totalModifiedPSMs: number; unknownModificationPSMs: number; uniqueModifications: number; entries: { name: string; theoreticalMass: number; observedMass: number; massDeviation: number; count: number; uniquePeptides: number; chargeStates: number; percentage: number; targetResidues: string; residueCounts: Record<string, number> }[] } } | null };

export type ProSEOptions = { /** Percolator rescoring: sets the parameter 'rescore' for the call (default: the parameter, true) */ rescore?: boolean } | null | undefined;

export type ProSEFilesOptions = { /** Percolator rescoring of each file: sets the parameter 'rescore' for the call (default: the parameter, true) */ rescore?: boolean; /** keep the peaks of the identified spectra with the results (default true) */ keepSpectra?: boolean; /** with the protein FDR, remove the decoy PSMs and proteins from the pooled results, as the ProSE tool's -out_merged does (default false: keep those that pass) */ removeDecoys?: boolean } | null | undefined;

export type ProSEFileSummary = { path: string; status: 'EXECUTION_OK' | 'INPUT_FILE_EMPTY' | 'UNEXPECTED_RESULT' | 'ILLEGAL_PARAMETERS' | 'UNKNOWN_ERROR'; ms2Spectra: number; targetPSMs: number; decoyPSMs: number; percolator: { applied: boolean; skipped: string | null; warning: string | null } | null; peptdeepNce: number | null; secondsSearch: number };

export type ProSEMultiSummary = { files: ProSEFileSummary[]; proteinFdrApplied: boolean; psmFdr: number; proteinFdr: number; decoyString: string; openSearch: boolean; modificationAnalysis: ProSESummary['modificationAnalysis'] };

export type ResultTables = { /** the input files, in the order of the search */ files: string[]; /** one row per identified spectrum (its best hit), in the order of the pooled PSMs */ psms: { count: number; /** position of the PSM's file in files */ file: Uint16Array; /** native ID of the spectrum */ nativeId: string[]; /** NaN: unknown */ rt: Float64Array; /** precursor m/z; NaN: unknown */ mz: Float64Array; charge: Int8Array; /** row of peptides */ peptide: Uint32Array; /** Percolator's (SVM) score if the search rescored the PSMs, else ProSE's ln(hyperscore); higher is better. A hit of a rescored file that Percolator could not rescore (e.g. without protein reference) has -100, with q-value and PEP 1, as Percolator's output gives it */ score: Float64Array; /** NaN: no FDR (no decoys) */ qValue: Float64Array; /** posterior error probability (Percolator); NaN: not rescored */ pep: Float64Array; /** NaN: unknown */ precursorErrorPpm: Float64Array; /** precursor isotope error, observed minus theoretical (in 13C spacings); 0: unknown */ isotopeError: Int8Array; /** mass shift of an open search (Da), not localized: peptides.proforma never has it (write '[+delta]?' + proforma, delta being the signed psms.deltaMass, e.g. '[-57.0215]?'); NaN: none */ deltaMass: Float64Array; /** 1: decoy */ decoy: Uint8Array; /** Percolator's input features, as ProSE's rescoring gives them: 'ln(hyperscore)' (its 'score'), the standard features of the .pin format that Percolator trains on (CalcMass, mass, peplen, charge<N> for N over the precursor charges of the search, enzN, enzC, enzInt, dm, absdm; computed by PercolatorInfile, also for searches without rescoring), the search engine's features (the 'extra_features' of the runs) and PeptDeep's (ms2_cosine, ms2_spectral_angle, ms2_pearson, ms2_frac_pred_found, rt_abs_error); of these, those that some PSM has */ featureNames: string[]; /** row-major, count * featureNames.length: features[i * featureNames.length + j]; NaN: absent */ features: Float64Array }; /** unique by openms */ peptides: { count: number; /** AASequence.toString(), e.g. 'AVM(Oxidation)DDFAAFVEK', '.(Acetyl)DAHKSEVAHR' */ openms: string[]; /** ProForma with Unimod names, fixed modifications included: 'AVM[Oxidation]DDFAAFVEK', '[Acetyl]-DAHKSEVAHR', 'PEPTIDER-[Amidated]'; other modifications as mass deltas, e.g. '[+15.9949]'. Never the unlocalized mass shift of an open search, which is a value of each PSM (psms.deltaMass) */ proforma: string[]; /** the residues */ sequence: string[]; /** 1: decoy */ decoy: Uint8Array; /** the modifications of peptide k: modOffsets[k] .. modOffsets[k + 1] of the mod* columns (count + 1 entries) */ modOffsets: Uint32Array; /** -1: N-terminus, sequence.length: C-terminus, else the 0-based residue */ modPosition: Int16Array; /** the (Unimod) name, e.g. 'Oxidation' */ modName: string[]; /** Unimod accession number, e.g. 35; -1: none */ modUnimod: Int32Array; /** monoisotopic mass delta (Da) */ modMass: Float64Array; /** the proteins of peptide k: proteinOffsets[k] .. proteinOffsets[k + 1] of protein, start and end (count + 1 entries); one per occurrence */ proteinOffsets: Uint32Array; /** row of proteins */ protein: Uint32Array; /** the peptide in proteins.sequence: 0-based start, exclusive end. Where the sequence has the peptide; if the sequence is unknown ('') or lacks the peptide, the position the search recorded, which may exceed sequence.length; 0 and 0 if none is recorded */ start: Uint32Array; end: Uint32Array }; /** the protein hits of the pooled run */ proteins: { count: number; accession: string[]; /** from the FASTA */ description: string[]; /** as searched: from the FASTA; a decoy that ProSE generated: as generated; '' if unknown */ sequence: string[]; /** the best score (psms.score) of its PSMs; NaN: none */ score: Float64Array; /** picked-protein FDR; NaN: no protein FDR */ qValue: Float64Array; /** 1: decoy */ decoy: Uint8Array; /** index of its indistinguishable-protein group; -1: none */ group: Int32Array } };

export type StoredSpectra = { /** per PSM row of ResultTables.psms: the index of its spectrum; -1: none (keepSpectra false, a q-value above FDR:PSM, no MS2 spectrum with its native ID in its file, or several of them and not exactly one at the PSM's RT, or a file that could not be read again). The PSMs of the same spectrum share it */ psmSpectrum: Int32Array; /** the peaks of spectrum s: offsets[s] .. offsets[s + 1] of mz and intensity (n + 1 entries) */ offsets: Uint32Array; /** the peaks of the MS2 spectra as read from the files (not preprocessed), sorted by m/z */ mz: Float32Array; intensity: Float32Array; /** m/z of the first precursor; NaN: none */ precursorMz: Float64Array; /** activation (collision) energy of the first precursor; NaN: unknown */ collisionEnergy: Float32Array };

export type AnnotationOptions = { tolerance?: number; unit?: 'Da' | 'ppm'; maxCharge?: number; ions?: ('a' | 'b' | 'c' | 'x' | 'y' | 'z')[]; losses?: boolean; precursor?: boolean } | null | undefined;

export type SpectrumAnnotation = { matches: { mz: number; intensity: number; ion: string; charge: number; theoreticalMZ: number; error: number }[]; theoretical: { mz: Float64Array; ion: string[]; charge: number[] }; unit: 'Da' | 'ppm' };

export type PeakMatch = { /** index of the peak in the mz and intensity arrays as passed (not in sorted order); in ppm several matches can have the same peak */ peak: number; /** the ion as labelled in a spectrum: 'b3'; 'y5++' (one '+' per charge, none for charge 1); 'y7-H2O' with a neutral loss; '[M+2H]++' and '[M+H-NH3]' for precursor peaks */ ion: string; /** 'a' to 'z', or 'precursor' */ type: string; /** the ion number (3 for b3); 0 for a precursor */ ordinal: number; charge: number; /** formula of the neutral loss ('H2O', 'NH3', 'H3PO4'); '' if none */ loss: string; theoreticalMz: number; /** (observed - theoretical) / theoretical * 1e6, whatever the unit of the tolerance */ errorPpm: number };

export type PeakAnnotationResult = { /** the ions that have a peak within the tolerance, by ascending m/z: one match per ion. In ppm each ion takes the closest peak, so several ions can have the same peak (the same index in peak), and of peaks of equal m/z the first in the arrays. In Da the matching is one to one and in m/z order: a peak has at most one ion (of two ions of one m/z, one is left out, unless there are two peaks), and of peaks of equal m/z one is taken; which one is unspecified */ matches: PeakMatch[]; /** every ion of the peptide for the options (charges 1 to maxCharge), by ascending m/z, matched or not */ theoretical: { ion: string; type: string; ordinal: number; charge: number; mz: number }[] };

export type PredictedIon = { /** the ion as annotatePeaks names it: 'b3'; 'y5++' (one '+' per charge, none for charge 1) */ ion: string; type: 'b' | 'y'; /** the ion number, 1 to the length of the peptide - 1 (3 for b3) */ ordinal: number; /** 2 only if the precursor has charge 2 or more */ charge: 1 | 2; /** from the theoretical spectrum, with the modifications of the peptide as given; the ions of a peptide come by ascending m/z */ mz: number; /** relative to the most intense returned b/y ion, which is 1; ions of 0.01 or less are left out. (For a precursor of charge 1 the model's own maximum may be in a channel that is not returned.) */ intensity: number };

export type BoundingBox = { minRT: number; maxRT: number; minMZ: number; maxMZ: number };

export type FeatureData = { uniqueId: string; rt: number; mz: number; intensity: number; charge: number; quality: number; width: number; boundingBox: BoundingBox | null; metaValues: MetaValues };

export type FeatureTable = { rt: Float64Array; mz: Float64Array; intensity: Float32Array; charge: Int32Array; quality: Float32Array; width: Float32Array };

export type ConsensusFeatureData = { uniqueId: string; rt: number; mz: number; intensity: number; charge: number; quality: number; elements: { mapIndex: number; uniqueId: string; rt: number; mz: number; intensity: number; charge: number }[]; metaValues: MetaValues };

interface EmbindModule {
  ResidueType: {Full: ResidueTypeValue<0>, Internal: ResidueTypeValue<1>, NTerminal: ResidueTypeValue<2>, CTerminal: ResidueTypeValue<3>, AIon: ResidueTypeValue<4>, BIon: ResidueTypeValue<5>, CIon: ResidueTypeValue<6>, XIon: ResidueTypeValue<7>, YIon: ResidueTypeValue<8>, ZIon: ResidueTypeValue<9>, Zp1Ion: ResidueTypeValue<10>, Zp2Ion: ResidueTypeValue<11>, Precursor: ResidueTypeValue<12>};
  AASequence: {
    new(): AASequence;
    new(_0: AASequence): AASequence;
    fromString(_0: EmbindString): AASequence;
    fromString(_0: EmbindString, _1: boolean): AASequence;
  };
  EmpiricalFormula: {
    new(): EmpiricalFormula;
    new(_0: EmpiricalFormula): EmpiricalFormula;
    fromString(_0: EmbindString): EmpiricalFormula;
  };
  IsotopeDistribution: {
    new(): IsotopeDistribution;
  };
  IsotopePatternGenerator: {};
  CoarseIsotopePatternGenerator: {
    new(): CoarseIsotopePatternGenerator;
    new(_0: number): CoarseIsotopePatternGenerator;
    new(_0: number, _1: boolean): CoarseIsotopePatternGenerator;
  };
  FineIsotopePatternGenerator: {
    new(): FineIsotopePatternGenerator;
    new(_0: number): FineIsotopePatternGenerator;
    new(_0: number, _1: boolean): FineIsotopePatternGenerator;
    new(_0: number, _1: boolean, _2: boolean): FineIsotopePatternGenerator;
  };
  ResidueDB: {
    getResidueNames(): string[];
    getResidue(_0: EmbindString): Residue;
  };
  ModificationsDB: {
    has(_0: EmbindString): boolean;
    getAllSearchModifications(): string[];
    searchModificationsByDiffMonoMass(_0: number, _1: number, _2: EmbindString): string[];
    getModification(_0: EmbindString): Modification;
    getBestModificationByDiffMonoMass(_0: number, _1: number, _2: EmbindString): Modification;
    getModification(_0: EmbindString, _1: EmbindString, _2: 'any' | 'C-term' | 'N-term' | 'Protein C-term' | 'Protein N-term' | 'none' | null | undefined): Modification;
  };
  ProteaseDB: {
    getAllNames(): string[];
    getEnzyme(_0: EmbindString): Enzyme;
  };
  ProteaseDigestion: {
    new(): ProteaseDigestion;
  };
  Feature: {
    new(): Feature;
    new(_0: Feature): Feature;
  };
  FeatureMap: {
    new(): FeatureMap;
    new(_0: FeatureMap): FeatureMap;
  };
  ConsensusMap: {
    new(): ConsensusMap;
    new(_0: ConsensusMap): ConsensusMap;
  };
  MassTraceList: {
    new(): MassTraceList;
  };
  MzMLFile: {
    new(): MzMLFile;
  };
  MzXMLFile: {
    new(): MzXMLFile;
  };
  FeatureXMLFile: {
    new(): FeatureXMLFile;
  };
  ConsensusXMLFile: {
    new(): ConsensusXMLFile;
  };
  IdXMLFile: {
    new(): IdXMLFile;
  };
  MzIdentMLFile: {
    new(): MzIdentMLFile;
  };
  FASTAFile: {
    new(): FASTAFile;
  };
  FileHandler: {
    new(): FileHandler;
    getType(_0: EmbindString): string;
    getTypeByFileName(_0: EmbindString): string;
    getTypeByContent(_0: EmbindString): string;
  };
  PeptideHit: {
    new(): PeptideHit;
    new(_0: PeptideHit): PeptideHit;
  };
  PeptideIdentification: {
    new(): PeptideIdentification;
    new(_0: PeptideIdentification): PeptideIdentification;
  };
  PeptideIdentificationList: {
    new(): PeptideIdentificationList;
  };
  ProteinHit: {
    new(): ProteinHit;
    new(_0: ProteinHit): ProteinHit;
  };
  ProteinIdentification: {
    new(): ProteinIdentification;
    new(_0: ProteinIdentification): ProteinIdentification;
  };
  ProteinIdentificationList: {
    new(): ProteinIdentificationList;
  };
  MSSpectrum: {
    new(): MSSpectrum;
    new(_0: MSSpectrum): MSSpectrum;
  };
  MSChromatogram: {
    new(): MSChromatogram;
    new(_0: MSChromatogram): MSChromatogram;
  };
  MSExperiment: {
    new(): MSExperiment;
    new(_0: MSExperiment): MSExperiment;
  };
  getVersion(): string;
  getRevision(): string;
  getBranch(): string;
  getOpenMSDataPath(): string;
  setLogEnabled(_0: EmbindString, _1: boolean): void;
  isLogEnabled(_0: EmbindString): boolean;
  hasONNXRuntime(): boolean;
  mountHostDirectory(_0: EmbindString, _1: EmbindString): void;
  unmount(_0: EmbindString): void;
  Param: {
    new(): Param;
    new(_0: Param): Param;
  };
  DefaultParamHandler: {};
  TheoreticalSpectrumGenerator: {
    new(): TheoreticalSpectrumGenerator;
  };
  MassTraceDetection: {
    new(): MassTraceDetection;
  };
  ElutionPeakDetection: {
    new(): ElutionPeakDetection;
  };
  FeatureFindingMetabo: {
    new(): FeatureFindingMetabo;
  };
  MascotGenericFile: {
    new(): MascotGenericFile;
  };
  SimpleSearchEngineAlgorithm: {
    new(): SimpleSearchEngineAlgorithm;
  };
  PeakPickerHiRes: {
    new(): PeakPickerHiRes;
  };
  GaussFilter: {
    new(): GaussFilter;
  };
  SavitzkyGolayFilter: {
    new(): SavitzkyGolayFilter;
  };
  Normalizer: {
    new(): Normalizer;
  };
  ThresholdMower: {
    new(): ThresholdMower;
  };
  WindowMower: {
    new(): WindowMower;
  };
  NLargest: {
    new(): NLargest;
    new(_0: number): NLargest;
  };
  SpectrumAlignment: {
    new(): SpectrumAlignment;
  };
  SpectrumAlignmentScore: {
    new(): SpectrumAlignmentScore;
  };
  ProSEResultSet: {};
  ProSEAlgorithm: {
    new(): ProSEAlgorithm;
  };
  getThreadingInfo(): ThreadingInfo;
  getMemoryInfo(): MemoryInfo;
  annotateSpectrum(_0: MSSpectrum, _1: AASequence, _2: number, _3: AnnotationOptions): SpectrumAnnotation;
  annotatePeaks(_0: ArrayLike<number>, _1: ArrayLike<number>, _2: EmbindString, _3: number, _4: AnnotationOptions): PeakAnnotationResult;
  predictMS2(_0: EmbindString, _1: number, _2: number, _3: EmbindString): PredictedIon[];
  predictMS2(_0: EmbindString, _1: number, _2: number, _3: EmbindString, _4: string | null | undefined): PredictedIon[];
}

export type MainModule = WasmModule & typeof RuntimeExports & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
