const { markdownToHtml } = require('../frontend/task-detail-utils');

describe('Task detail markdown utils', () => {
  it('should render bold, italic and inline code', () => {
    const html = markdownToHtml('**bold** *italic* `code`');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code>code</code>');
  });

  it('should render safe links only with http/https', () => {
    const html = markdownToHtml('[OpenAI](https://openai.com)');
    expect(html).toContain('<a href="https://openai.com"');
  });

  it('should escape raw html to prevent injection', () => {
    const html = markdownToHtml('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });
});
