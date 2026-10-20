// Command registry with AutoCAD-style aliases (acad.pgp conventions).

import type { Editor, CommandDef } from '../editor.ts';
import * as D from './draw.ts';
import * as M from './modify.ts';
import * as A from './annotate.ts';
import * as U from './misc.ts';
import * as X from './extra.ts';

const defs: CommandDef[] = [
  // Draw
  { name: 'LINE', aliases: ['L'], desc: 'Draw: straight line segments', fn: D.LINE },
  { name: 'PLINE', aliases: ['PL'], desc: 'Draw: 2D polyline', fn: D.PLINE },
  { name: 'CIRCLE', aliases: ['C'], desc: 'Draw: circle', fn: D.CIRCLE },
  { name: 'ARC', aliases: ['A'], desc: 'Draw: arc', fn: D.ARC },
  { name: 'RECTANG', aliases: ['REC', 'RECTANGLE'], desc: 'Draw: rectangular polyline', fn: D.RECTANG },
  { name: 'POLYGON', aliases: ['POL'], desc: 'Draw: equilateral closed polyline', fn: D.POLYGON },
  { name: 'ELLIPSE', aliases: ['EL'], desc: 'Draw: ellipse or elliptical arc', fn: D.ELLIPSE },
  { name: 'SPLINE', aliases: ['SPL'], desc: 'Draw: smooth curve through points', fn: D.SPLINE },
  { name: 'POINT', aliases: ['PO'], desc: 'Draw: point object', fn: D.POINT },
  { name: 'HATCH', aliases: ['H', 'BH', 'BHATCH'], desc: 'Draw: fill an area with a hatch pattern', fn: D.HATCH },
  // Modify
  { name: 'ERASE', aliases: ['E', 'DELETE'], desc: 'Modify: remove objects', fn: M.ERASE },
  { name: 'MOVE', aliases: ['M'], desc: 'Modify: move objects', fn: M.MOVE },
  { name: 'COPY', aliases: ['CO', 'CP'], desc: 'Modify: copy objects', fn: M.COPY },
  { name: 'ROTATE', aliases: ['RO'], desc: 'Modify: rotate objects', fn: M.ROTATE },
  { name: 'SCALE', aliases: ['SC'], desc: 'Modify: scale objects', fn: M.SCALE },
  { name: 'MIRROR', aliases: ['MI'], desc: 'Modify: mirror objects', fn: M.MIRROR },
  { name: 'OFFSET', aliases: ['O'], desc: 'Modify: offset curves', fn: M.OFFSET },
  { name: 'TRIM', aliases: ['TR'], desc: 'Modify: trim objects', fn: M.TRIM },
  { name: 'EXTEND', aliases: ['EX'], desc: 'Modify: extend objects', fn: M.EXTEND },
  { name: 'FILLET', aliases: ['F'], desc: 'Modify: round corners', fn: M.FILLET },
  { name: 'CHAMFER', aliases: ['CHA'], desc: 'Modify: bevel corners', fn: M.CHAMFER },
  { name: 'ARRAY', aliases: ['AR'], desc: 'Modify: array copies', fn: M.ARRAY },
  { name: 'ARRAYRECT', desc: 'Modify: rectangular array', fn: M.ARRAYRECT },
  { name: 'ARRAYPOLAR', desc: 'Modify: polar array', fn: M.ARRAYPOLAR },
  { name: 'EXPLODE', aliases: ['X'], desc: 'Modify: break compound objects apart', fn: M.EXPLODE },
  { name: 'STRETCH', aliases: ['S'], desc: 'Modify: stretch objects crossed by a window', fn: M.STRETCH },
  { name: 'BREAK', aliases: ['BR'], desc: 'Modify: break an object between two points', fn: M.BREAK },
  { name: 'BREAKATPOINT', desc: 'Modify: break an object at a point', fn: M.BREAKATPOINT },
  { name: 'JOIN', aliases: ['J'], desc: 'Modify: join lines/arcs/polylines', fn: M.JOIN },
  { name: 'MATCHPROP', aliases: ['MA', 'PAINTER'], desc: 'Modify: copy properties to objects', fn: M.MATCHPROP },
  // Annotate
  { name: 'TEXT', aliases: ['DT', 'DTEXT'], desc: 'Annotate: single-line text', fn: A.TEXT },
  { name: 'MTEXT', aliases: ['T', 'MT'], desc: 'Annotate: multiline text', fn: A.MTEXT },
  { name: 'TEXTEDIT', aliases: ['ED', 'DDEDIT'], desc: 'Annotate: edit text', fn: A.TEXTEDIT },
  { name: 'DIMLINEAR', aliases: ['DLI', 'DIM'], desc: 'Annotate: linear dimension', fn: A.DIMLINEAR },
  { name: 'DIMALIGNED', aliases: ['DAL'], desc: 'Annotate: aligned dimension', fn: A.DIMALIGNED },
  { name: 'DIMRADIUS', aliases: ['DRA'], desc: 'Annotate: radius dimension', fn: A.DIMRADIUS },
  { name: 'DIMDIAMETER', aliases: ['DDI'], desc: 'Annotate: diameter dimension', fn: A.DIMDIAMETER },
  { name: 'DIMANGULAR', aliases: ['DAN'], desc: 'Annotate: angular dimension', fn: A.DIMANGULAR },
  { name: 'MLEADER', aliases: ['MLD', 'LEADER', 'LE', 'QLEADER'], desc: 'Annotate: leader with text', fn: A.MLEADER },
  // View
  { name: 'ZOOM', aliases: ['Z'], desc: 'View: zoom', fn: U.ZOOM, noUndo: true, noRepeat: true },
  { name: 'PAN', aliases: ['P'], desc: 'View: pan', fn: U.PAN, noUndo: true, noRepeat: true },
  { name: 'REGEN', aliases: ['RE', 'REGENALL', 'REA'], desc: 'View: regenerate', fn: U.REGEN, noUndo: true },
  // Utility
  { name: 'UNDO', aliases: ['U'], desc: 'Utility: undo', fn: U.UNDO, noUndo: true, noRepeat: true },
  { name: 'REDO', desc: 'Utility: redo', fn: U.REDO, noUndo: true, noRepeat: true },
  { name: 'LAYER', aliases: ['LA'], desc: 'Utility: layer properties manager', fn: U.LAYER, noUndo: true },
  { name: 'PROPERTIES', aliases: ['PR', 'CH', 'MO', 'PROPS'], desc: 'Utility: properties palette', fn: U.PROPERTIES, noUndo: true },
  { name: 'DIST', aliases: ['DI'], desc: 'Utility: measure distance', fn: U.DIST, noUndo: true },
  { name: 'ID', desc: 'Utility: point coordinates', fn: U.ID, noUndo: true },
  { name: 'LIST', aliases: ['LI', 'LS'], desc: 'Utility: list object data', fn: U.LIST, noUndo: true },
  { name: 'AREA', aliases: ['AA'], desc: 'Utility: area and perimeter', fn: U.AREA, noUndo: true },
  { name: 'SELECTALL', aliases: ['AI_SELALL'], desc: 'Utility: select all', fn: U.SELECTALL, noUndo: true, noRepeat: true },
  { name: 'LAYMCUR', desc: 'Utility: make object layer current', fn: U.LAYMCUR },
  { name: 'PURGE', aliases: ['PU'], desc: 'Utility: remove unused blocks and layers', fn: U.PURGE },
  { name: 'LTSCALE', aliases: ['LTS'], desc: 'Utility: global linetype scale', fn: U.LTSCALE },
  { name: 'DIMSCALE', desc: 'Utility: dimension scale', fn: U.DIMSCALE },
  { name: 'OSNAP', aliases: ['OS', '-OSNAP'], desc: 'Utility: object snap modes', fn: U.OSNAP, noUndo: true },
  { name: 'ABOUT', aliases: ['VERSION', 'WHATSNEW'], desc: 'Utility: version and changelog', fn: U.ABOUT, noUndo: true, noRepeat: true },
  { name: 'HELP', aliases: ['?'], desc: 'Utility: list commands', fn: U.HELP, noUndo: true, noRepeat: true },
  // Clipboard
  { name: 'COPYCLIP', desc: 'Clipboard: copy', fn: U.COPYCLIP, noUndo: true, noRepeat: true },
  { name: 'CUTCLIP', desc: 'Clipboard: cut', fn: U.CUTCLIP, noRepeat: true },
  { name: 'COPYBASE', desc: 'Clipboard: copy with base point', fn: U.COPYBASE, noUndo: true },
  { name: 'PASTECLIP', desc: 'Clipboard: paste', fn: U.PASTECLIP, noRepeat: true },
  // Blocks
  { name: 'BLOCK', aliases: ['B', '-B'], desc: 'Block: create block definition', fn: U.BLOCK },
  { name: 'INSERT', aliases: ['I', '-I', 'DDINSERT'], desc: 'Block: insert block', fn: U.INSERT },
  // Settings & output
  { name: 'SETVAR', aliases: ['SET'], desc: 'Utility: view or change a system variable', fn: X.SETVAR, noUndo: true },
  { name: 'GRID', desc: 'Utility: grid spacing and display', fn: X.GRID, noUndo: true },
  { name: 'SNAP', aliases: ['SN'], desc: 'Utility: snap spacing', fn: X.SNAP, noUndo: true },
  { name: 'DSETTINGS', aliases: ['DS', 'SE', 'DDRMODES', 'OPTIONS', 'OP'], desc: 'Utility: drafting settings', fn: X.DSETTINGS, noUndo: true },
  { name: 'PLOT', aliases: ['PRINT'], desc: 'Output: plot to PDF or image', fn: X.PLOT, noUndo: true },
  { name: 'DIMSTYLE', aliases: ['D', 'DST', 'DDIM'], desc: 'Annotate: dimension style manager', fn: X.DIMSTYLE, noUndo: true },
  { name: 'HATCHEDIT', aliases: ['HE'], desc: 'Modify: edit hatch pattern, scale and angle', fn: X.HATCHEDIT },
  { name: 'BEDIT', aliases: ['BE'], desc: 'Block: open the Block Editor', fn: X.BEDIT, noUndo: true, noRepeat: true },
  { name: 'BSAVE', desc: 'Block: save the block being edited', fn: X.BSAVE, noUndo: true, noRepeat: true },
  { name: 'BCLOSE', desc: 'Block: close the Block Editor', fn: X.BCLOSE, noUndo: true, noRepeat: true },
  { name: 'BASE', desc: 'Block: set base point', fn: X.BASE },
  { name: 'SELECTSIMILAR', desc: 'Utility: select similar objects', fn: X.SELECTSIMILAR, noUndo: true, noRepeat: true },
  { name: 'ADDSELECTED', desc: 'Utility: create an object like the selected one', fn: X.ADDSELECTED, noUndo: true, noRepeat: true },
  { name: 'QSELECT', desc: 'Utility: quick select by property', fn: X.QSELECT, noUndo: true, noRepeat: true },
  { name: 'PASTEORIG', desc: 'Clipboard: paste to original coordinates', fn: X.PASTEORIG, noRepeat: true },
  { name: 'PASTEBLOCK', desc: 'Clipboard: paste as block', fn: X.PASTEBLOCK, noRepeat: true },
  { name: 'DRAWORDER', aliases: ['DR'], desc: 'Modify: change draw order', fn: X.DRAWORDER },
  // File
  { name: 'NEW', desc: 'File: new drawing', fn: U.NEW, noUndo: true, noRepeat: true },
  { name: 'OPEN', desc: 'File: open DXF/DWG', fn: U.OPEN, noUndo: true, noRepeat: true },
  { name: 'QSAVE', aliases: ['SAVE'], desc: 'File: save', fn: U.QSAVE, noUndo: true, noRepeat: true },
  { name: 'SAVEAS', desc: 'File: save as', fn: U.SAVEAS, noUndo: true, noRepeat: true },
];

export function registerCommands(ed: Editor): void {
  for (const d of defs) ed.register(d);
  X.installSysvars(ed);
}
