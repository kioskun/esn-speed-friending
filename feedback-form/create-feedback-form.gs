/**
 * ESN Speed Friending - feedback form builder
 *
 * Creates a short Google Form in the Drive of the account that runs it,
 * then prints the link to share (and to paste into the app's Settings).
 *
 * How to use:
 *   1. Go to https://script.google.com signed in to the event's Google account.
 *   2. New project, delete what is there, paste this whole file.
 *   3. Press Run (function: createFeedbackForm) and allow access when asked.
 *   4. Open "Execution log" and copy the "Share this link" address.
 *
 * Running it again makes a second, separate form.
 */
function createFeedbackForm() {
  var form = FormApp.create('ESN Speed Friending - Feedback');
  form.setDescription(
    'Thanks for joining ESN Speed Friending! This takes about one minute. ' +
    'Your answers are anonymous and help us make the next one even better.'
  );
  form.setCollectEmail(false);
  form.setLimitOneResponsePerUser(false);   // no Google sign-in needed
  form.setProgressBar(false);
  form.setConfirmationMessage('Thank you! See you at the next ESN event 💙');

  form.addScaleItem()
    .setTitle('How much did you enjoy the evening overall?')
    .setBounds(1, 5)
    .setLabels('Not at all', 'Loved it')
    .setRequired(true);

  form.addScaleItem()
    .setTitle('How easy was it to know where to go at each rotation?')
    .setBounds(1, 5)
    .setLabels('Very confusing', 'Very easy')
    .setRequired(false);

  form.addMultipleChoiceItem()
    .setTitle('How long were the conversations?')
    .setChoiceValues(['Too short', 'Just right', 'Too long'])
    .setRequired(false);

  form.addMultipleChoiceItem()
    .setTitle('How many new people did you really connect with?')
    .setChoiceValues(['None', '1-2', '3-5', 'More than 5'])
    .setRequired(false);

  form.addMultipleChoiceItem()
    .setTitle('Would you come to another ESN Speed Friending?')
    .setChoiceValues(['Yes', 'Maybe', 'No'])
    .setRequired(false);

  form.addCheckboxItem()
    .setTitle('How did you hear about the event?')
    .setChoiceValues(['Instagram', 'Facebook', 'A friend', 'ESN newsletter or website', 'University'])
    .showOtherOption(true)
    .setRequired(false);

  form.addParagraphTextItem()
    .setTitle('What was the best part, and what should we change?')
    .setRequired(false);

  var shortUrl = form.getPublishedUrl();
  try { shortUrl = form.shortenFormUrl(shortUrl); } catch (e) {}

  Logger.log('Form created.');
  Logger.log('Share this link (paste it into the app: Settings > Feedback form link): ' + shortUrl);
  Logger.log('Edit the form and see answers here: ' + form.getEditUrl());
}
