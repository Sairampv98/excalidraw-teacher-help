/**
 * The subset of the VS Code stable API that this extension uses.
 *
 * `@types/vscode` is NOT installed - this fork adds no npm dependency, and a
 * published extension must not depend on a proposed API. The editor provides
 * the real `vscode` module at run time; this file exists so that the
 * repository's own `tsc` can check the extension's use of it.
 *
 * Only the STABLE API appears here. `onDidWriteTerminalData` is deliberately
 * absent: it is proposed-only, which is exactly why the extension owns the
 * process it runs (D-51).
 *
 * If `@types/vscode` is ever added to the repository, this file must be
 * deleted, not merged - two declarations of the same module do not coexist.
 */
declare module "vscode" {
  export interface Disposable {
    dispose(): any;
  }

  export interface Event<T> {
    (
      listener: (e: T) => any,
      thisArgs?: any,
      disposables?: Disposable[],
    ): Disposable;
  }

  export interface Thenable<T> extends PromiseLike<T> {}

  export class EventEmitter<T> {
    event: Event<T>;
    fire(data: T): void;
    dispose(): void;
  }

  export interface Position {
    line: number;
    character: number;
  }

  export interface Range {
    start: Position;
    end: Position;
  }

  export interface Selection {
    start: Position;
    end: Position;
  }

  export interface Uri {
    readonly scheme: string;
    readonly fsPath: string;
    toString(): string;
  }

  export interface TextDocument {
    readonly uri: Uri;
    readonly fileName: string;
    readonly languageId: string;
    readonly version: number;
    getText(): string;
    offsetAt(position: Position): number;
  }

  export interface TextEditor {
    readonly document: TextDocument;
    readonly selection: Selection;
  }

  export interface TextDocumentChangeEvent {
    readonly document: TextDocument;
  }

  export interface TextEditorSelectionChangeEvent {
    readonly textEditor: TextEditor;
  }

  export interface WorkspaceFolder {
    readonly uri: Uri;
    readonly name: string;
    readonly index: number;
  }

  export interface WorkspaceConfiguration {
    get<T>(section: string): T | undefined;
    get<T>(section: string, defaultValue: T): T;
  }

  export interface StatusBarItem {
    text: string;
    tooltip: string | undefined;
    command: string | undefined;
    show(): void;
    hide(): void;
    dispose(): void;
  }

  export enum StatusBarAlignment {
    Left = 1,
    Right = 2,
  }

  export interface TerminalDimensions {
    columns: number;
    rows: number;
  }

  export interface Pseudoterminal {
    onDidWrite?: Event<string>;
    onDidClose?: Event<number | void>;
    open(initialDimensions: TerminalDimensions): void;
    close(): void;
    handleInput?(data: string): void;
  }

  export interface TaskDefinition {
    readonly type: string;
    readonly [name: string]: any;
  }

  export class CustomExecution {
    constructor(
      callback: (
        resolvedDefinition: TaskDefinition,
      ) => Thenable<Pseudoterminal>,
    );
  }

  export interface ProcessExecution {
    readonly process: string;
    readonly args: string[];
    readonly options?: { cwd?: string; env?: any };
  }

  export interface ShellExecution {
    readonly command: string;
    readonly args?: string[];
    readonly options?: { cwd?: string; env?: any };
  }

  export enum TaskScope {
    Global = 1,
    Workspace = 2,
  }

  export enum TaskRevealKind {
    Always = 1,
    Silent = 2,
    Never = 3,
  }

  export enum TaskPanelKind {
    Shared = 1,
    Dedicated = 2,
    New = 3,
  }

  export class Task {
    constructor(
      definition: TaskDefinition,
      scope: TaskScope | WorkspaceFolder | string,
      name: string,
      source: string,
      execution?: ProcessExecution | ShellExecution | CustomExecution,
      problemMatchers?: string | string[],
    );
    readonly definition: TaskDefinition;
    readonly execution?: ProcessExecution | ShellExecution | CustomExecution;
  }

  export interface TaskExecution {
    readonly task: Task;
    terminate(): void;
  }

  export interface TaskProvider {
    provideTasks(token?: any): Task[] | Thenable<Task[]>;
    resolveTask(task: Task): Task | undefined | Thenable<Task | undefined>;
  }

  export interface ExtensionContext {
    readonly subscriptions: { dispose(): any }[];
    readonly extension: { id: string; packageJSON: any };
  }

  export namespace window {
    export const activeTextEditor: TextEditor | undefined;
    /**
     * The tab groups of this window.
     *
     * The **active tab** is known even when the window does not have the
     * focus - which is exactly when the teacher needs the mirror: they are
     * teaching from the editor and have switched to the browser to show the
     * canvas (D-79).
     *
     * The shape is taken from the INSTALLED API declaration (VSCodium
     * 1.135.06055): `TabInputText` carries only a **uri**, and the tab's
     * input is a union that can also be a diff, a terminal, a notebook or a
     * webview. There is NO `document` on a tab input - an earlier version of
     * this stub had one, and the mirror silently fell through to the
     * remembered editor instead.
     */
    export const tabGroups: {
      readonly activeTabGroup:
        | {
            readonly activeTab:
              | {
                  readonly input:
                    | { readonly uri?: { toString(): string } }
                    | {
                        readonly original?: { toString(): string };
                        readonly modified?: { toString(): string };
                      }
                    | {
                        readonly uri?: undefined;
                        readonly original?: undefined;
                      };
                }
              | undefined;
          }
        | undefined;
    };
    export function onDidChangeActiveTextEditor(
      listener: (e: TextEditor | undefined) => any,
    ): Disposable;
    export function onDidChangeTextEditorSelection(
      listener: (e: TextEditorSelectionChangeEvent) => any,
    ): Disposable;
    export function showInformationMessage(
      message: string,
      ...items: string[]
    ): Thenable<string | undefined>;
    export function showErrorMessage(
      message: string,
      ...items: string[]
    ): Thenable<string | undefined>;
    export function createStatusBarItem(
      alignment?: StatusBarAlignment,
      priority?: number,
    ): StatusBarItem;
  }

  export namespace workspace {
    export const workspaceFolders: readonly WorkspaceFolder[] | undefined;
    /**
     * Every text document that is currently OPEN - including the ones that
     * are open in a tab but not the active editor.
     *
     * The bridge needs it to tell "the focus moved to a terminal" (the
     * document is still open) from "the file was closed" (it is not).
     */
    export const textDocuments: readonly TextDocument[];
    export function onDidChangeTextDocument(
      listener: (e: TextDocumentChangeEvent) => any,
    ): Disposable;
    export function getConfiguration(section?: string): WorkspaceConfiguration;
  }

  export namespace tasks {
    export function registerTaskProvider(
      type: string,
      provider: TaskProvider,
    ): Disposable;
    export function executeTask(task: Task): Thenable<TaskExecution>;
    export function fetchTasks(filter?: { type?: string }): Thenable<Task[]>;
  }

  export namespace commands {
    export function registerCommand(
      command: string,
      callback: (...args: any[]) => any,
    ): Disposable;
    export function executeCommand<T = unknown>(
      command: string,
      ...rest: any[]
    ): Thenable<T>;
  }

  export namespace env {
    export const clipboard: {
      writeText(value: string): Thenable<void>;
      readText(): Thenable<string>;
    };
    /**
     * The name of the editor: "Visual Studio Code", "VSCodium", ...
     *
     * The bridge sends it in `bridge:hello`, so the app can say which editor
     * it is talking to (D-76).
     */
    export const appName: string;
  }
}
