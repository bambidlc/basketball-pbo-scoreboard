// Keep the embedded editor visible when a document is selected from the list.
document.querySelectorAll('a[target="acb-form-editor"]').forEach(link => {
  link.addEventListener('click', () => {
    const editor = document.querySelector('iframe[name="acb-form-editor"]');
    if (editor) editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});
