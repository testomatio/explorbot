Feature('Sample Test');

Scenario('Basic navigation test', ({ I }) => {
  I.amOnPage('/');
  I.see('Welcome');
});
