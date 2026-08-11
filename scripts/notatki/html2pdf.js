#!/usr/bin/env osascript -l JavaScript
//
// html2pdf.js — konwersja HTML → PDF wyłącznie na wbudowanych API macOS (AppKit).
// Zero zależności: nie wymaga wkhtmltopdf, pandoc, Chrome ani niczego z brew.
//
// Wywołanie:
//   osascript -l JavaScript html2pdf.js <plik.html> <plik.pdf> [A4|LETTER]
//
// Mechanizm: NSAttributedString parsuje HTML (silnik WebKit), wynik ląduje w
// NSTextView, a NSPrintOperation z dispozycją NSPrintSaveJob renderuje go do
// wielostronicowego PDF-a bez otwierania okna drukowania.
//
// Kod wyjścia: 0 = sukces (PDF istnieje i jest niepusty), != 0 = błąd na stderr.

ObjC.import('AppKit');
ObjC.import('Foundation');

function run(argv) {
  if (argv.length < 2) {
    throw new Error('Uzycie: html2pdf.js <plik.html> <plik.pdf> [A4|LETTER]');
  }

  var srcPath = argv[0];
  var dstPath = argv[1];
  var paper = (argv[2] || 'A4').toUpperCase();

  var PAPERS = { A4: [595.28, 841.89], LETTER: [612.0, 792.0] };
  var size = PAPERS[paper] || PAPERS.A4;
  var pageW = size[0], pageH = size[1];
  var margin = 42.0; // ~1,5 cm

  var fm = $.NSFileManager.defaultManager;
  if (!fm.fileExistsAtPath($(srcPath))) {
    throw new Error('Brak pliku zrodlowego: ' + srcPath);
  }

  // --- HTML -> NSAttributedString -------------------------------------------
  var url = $.NSURL.fileURLWithPath($(srcPath));
  var opts = $.NSDictionary.dictionaryWithObjectsAndKeys(
    $('NSHTML'), $('DocumentType'),
    $.NSNumber.numberWithInt(4), $('CharacterEncoding'), // NSUTF8StringEncoding
    $()
  );

  var attr = $.NSAttributedString.alloc
    .initWithURLOptionsDocumentAttributesError(url, opts, null, null);

  if (!attr || attr.isNil()) {
    throw new Error('Nie udalo sie sparsowac HTML: ' + srcPath);
  }

  // --- uklad tekstu ----------------------------------------------------------
  var contentW = pageW - 2 * margin;
  var contentH = pageH - 2 * margin;

  var textView = $.NSTextView.alloc.initWithFrame(
    $.NSMakeRect(0, 0, contentW, contentH)
  );
  textView.setVerticallyResizable(true);
  textView.setHorizontallyResizable(false);
  textView.textContainer.setContainerSize($.NSMakeSize(contentW, 1.0e7));
  textView.textContainer.setWidthTracksTextView(true);
  textView.textStorage.setAttributedString(attr);

  // wymuszenie layoutu, zeby poznac realna wysokosc tresci
  textView.layoutManager.glyphRangeForTextContainer(textView.textContainer);
  var used = textView.layoutManager.usedRectForTextContainer(textView.textContainer);
  var neededH = Math.max(contentH, used.size.height + 8.0);
  textView.setFrameSize($.NSMakeSize(contentW, neededH));

  // --- konfiguracja "wydruku" do pliku PDF -----------------------------------
  var printInfo = $.NSPrintInfo.sharedPrintInfo.copy;
  printInfo.setPaperSize($.NSMakeSize(pageW, pageH));
  printInfo.setLeftMargin(margin);
  printInfo.setRightMargin(margin);
  printInfo.setTopMargin(margin);
  printInfo.setBottomMargin(margin);
  printInfo.setHorizontalPagination(1); // NSFitPagination — dopasuj szerokosc
  printInfo.setVerticalPagination(0);   // NSAutoPagination — lam na strony
  printInfo.setJobDisposition($('NSPrintSaveJob'));
  printInfo.dictionary.setObjectForKey(
    $.NSURL.fileURLWithPath($(dstPath)),
    $('NSJobSavingURL')
  );

  var op = $.NSPrintOperation.printOperationWithViewPrintInfo(textView, printInfo);
  op.setShowsPrintPanel(false);
  op.setShowsProgressPanel(false);

  var ok = op.runOperation;
  if (!ok) {
    throw new Error('NSPrintOperation nie powiodla sie dla: ' + srcPath);
  }

  // --- weryfikacja wyniku ----------------------------------------------------
  if (!fm.fileExistsAtPath($(dstPath))) {
    throw new Error('PDF nie powstal: ' + dstPath);
  }
  var attrs = fm.attributesOfItemAtPathError($(dstPath), null);
  var bytes = attrs ? attrs.objectForKey($('NSFileSize')).intValue : 0;
  if (bytes <= 0) {
    throw new Error('PDF jest pusty (0 B): ' + dstPath);
  }

  return dstPath;
}
