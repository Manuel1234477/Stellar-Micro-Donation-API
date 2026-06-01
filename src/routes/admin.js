const express = require('express');
const router = express.Router();
const { verifyAdmin } = require('../middleware/auth'); // assuming you have this

const i18nController = require('../controllers/admin/i18nController');

router.get('/i18n/messages', verifyAdmin, i18nController.getAllMessages);
router.patch('/i18n/messages/:lang/:key', verifyAdmin, i18nController.updateTranslation);
router.post('/i18n/languages', verifyAdmin, i18nController.addLanguage);

module.exports = router;