if (window.Lenis && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  new Lenis({ autoRaf: true, lerp: 0.14, anchors: { offset: -32 } });
}

if (!matchMedia('(prefers-reduced-motion: reduce)').matches && window.IntersectionObserver) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(({ target, isIntersecting }) => {
      if (isIntersecting) {
        target.classList.replace('reveal-pending', 'reveal-visible');
        observer.unobserve(target);
      }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('.used-by > *, .section-heading > *, .card, .faq > div, .answers details, .alpha > div, footer > *').forEach(element => {
    element.style.setProperty('--reveal-delay', `${Math.min([...element.parentElement.children].indexOf(element), 4) * 85}ms`);
    element.classList.add('reveal-pending');
    observer.observe(element);
  });
}
