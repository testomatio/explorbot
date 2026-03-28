Stress-test the page by filling invalid, empty, and extreme values into every input.

Focus on:
- Empty states: submit forms with no data, clear required fields, remove default values
- Long values: paste 10000 characters into inputs, use extremely long names and descriptions
- Boundary values: zero, negative numbers, special characters, unicode, HTML tags in text fields
- Invalid formats: wrong email formats, letters in number fields, SQL injection strings, script tags
- Invalid combinations: select incompatible options, mix conflicting settings
- Combining states: apply multiple filters at once, use conflicting form values together
- Out-of-range values: dates in the past/future, quantities beyond limits, prices with too many decimals

Push every input to its limits. Find what breaks when the form receives unexpected data.

Skip the Menu/Navigation section — we are testing THIS page.