const guide = document.querySelector('#install-guide');
if (guide) {
  document.querySelectorAll('a[download]').forEach(link => {
    link.addEventListener('click', () => {
      setTimeout(() => { if (!guide.open) guide.showModal(); }, 0);
    });
  });
  guide.querySelector('[data-close]').addEventListener('click', () => guide.close());
}
