const mongoose = require('mongoose');

const translationSchema = new mongoose.Schema({
  key: { 
    type: String, 
    required: true, 
    unique: true 
  },
  translations: {
    type: Map,
    of: String,
    default: {}
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

module.exports = mongoose.model('Translation', translationSchema);