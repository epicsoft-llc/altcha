// The source of /widget.csp.js, built once at start: the widget for a page whose Content Security Policy allows no
// inline style. It links widget.css under the id the widget checks for, so widget.js adds no <style> element of its
// own, then loads the texts of the one language the widget will show - English is part of widget.js.

export function cspWidget(languages) {
  return `// The ALTCHA widget without inline style, built by the form service: style sheet, widget, texts of one language.
const base = new URL('./', import.meta.url);
const languages = ${JSON.stringify(languages)};
if (document.getElementById('altcha-css') === null) {
  const link = document.createElement('link');
  link.id = 'altcha-css';
  link.rel = 'stylesheet';
  link.href = new URL('widget.css', base).href;
  document.head.append(link);
}
await import(new URL('widget.js', base).href);
// The widget's own order: its language attribute, the page, the browser - the exact code first, else the base language.
const known = (code) => languages.find((language) => language === code)
  ?? languages.find((language) => language.split('-')[0] === code.split('-')[0]);
const widgets = [...document.querySelectorAll('altcha-widget')];
const wanted = new Set((widgets.length > 0 ? widgets : [null]).map((widget) =>
  [widget?.getAttribute('language'), document.documentElement.lang, ...(navigator.languages ?? [])]
    .filter(Boolean).map(known).find(Boolean)));
wanted.delete(undefined);
wanted.delete('en');
await Promise.all([...wanted].map((code) => import(new URL(\`i18n/\${code}.js\`, base).href)));
`;
}
