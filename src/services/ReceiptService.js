/**
 * ReceiptService - Donation Receipt Generation and Email Delivery
 *
 * RESPONSIBILITY: Generate PDF receipts for confirmed donations and optionally
 *                 deliver them via SMTP email.
 *
 * PDF includes:
 *   - Transaction ID and Stellar transaction hash
 *   - Amount, date, donor, and recipient information
 *   - QR code linking to the Stellar explorer
 *
 * Configuration (environment variables):
 *   SMTP_HOST       - SMTP server hostname (default: localhost)
 *   SMTP_PORT       - SMTP server port (default: 587)
 *   SMTP_USER       - SMTP username
 *   SMTP_PASS       - SMTP password
 *   SMTP_FROM       - Sender address (default: receipts@stellar-donations.local)
 *   STELLAR_EXPLORER_URL - Base URL for Stellar explorer
 *                          (default: https://stellar.expert/explorer/testnet/tx)
 */

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');
const log = require('../utils/log');

const EXPLORER_BASE =
  process.env.STELLAR_EXPLORER_URL ||
  'https://stellar.expert/explorer/testnet/tx';

/**
 * Mask a Stellar public key for privacy.
 * Shows the first 8 and last 4 characters with "..." in the middle.
 * Returns the key unchanged when it is too short to mask sensibly.
 *
 * @param {string} key - Full public key
 * @returns {string} Masked key, e.g. "GABCDEFG...WXYZ"
 */
function maskPublicKey(key) {
  if (!key || key.length <= 12) return key || '';
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

class ReceiptService {
  /**
   * Generate a PDF receipt Buffer for a donation transaction.
   *
   * @param {object} transaction - Donation transaction record
   * @param {string} transaction.id - Internal transaction ID
   * @param {string} [transaction.stellarTxId] - Stellar transaction hash
   * @param {number|string} transaction.amount - Donation amount in XLM
   * @param {string} transaction.timestamp - ISO timestamp
   * @param {string} [transaction.donor] - Donor public key
   * @param {string} transaction.recipient - Recipient public key
   * @param {string} transaction.status - Transaction status
   * @param {object} [options={}]
   * @param {boolean} [options.compress=true]       - Compress PDF streams (disable for testing)
   * @param {boolean} [options.maskKeys=true]        - Mask donor/recipient public keys
   * @param {boolean} [options.isPending=false]      - Add "PENDING CONFIRMATION" watermark
   * @param {string}  [options.receiptNumber]        - Receipt number to print; auto-generated if omitted
   * @param {number|null} [options.usdAmount=null]   - USD equivalent; omitted if null/undefined
   * @returns {Promise<Buffer>} PDF file as a Buffer
   */
  static async generatePDF(transaction, {
    compress = true,
    maskKeys = true,
    isPending = false,
    receiptNumber,
    usdAmount = null,
  } = {}) {
    const explorerUrl = transaction.stellarTxId
      ? `${EXPLORER_BASE}/${transaction.stellarTxId}`
      : null;

    const rcptNumber = receiptNumber || `RCP-${String(transaction.id).padStart(6, '0')}`;

    // Apply public key masking unless caller opts into full disclosure
    const displayDonor = maskKeys
      ? maskPublicKey(transaction.donor)
      : (transaction.donor || 'Anonymous');
    const displayRecipient = maskKeys
      ? maskPublicKey(transaction.recipient)
      : (transaction.recipient || 'N/A');

    // Generate QR code as a PNG data URL (or placeholder if no hash)
    let qrDataUrl = null;
    if (explorerUrl) {
      qrDataUrl = await QRCode.toDataURL(explorerUrl, { width: 120, margin: 1 });
    }

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        compress,
        info: {
          Title: `Donation Receipt ${rcptNumber}`,
          Author: 'Stellar Micro-Donation Platform',
          Subject: `Receipt for transaction ${transaction.stellarTxId || transaction.id}`,
          Keywords: [
            transaction.id,
            transaction.stellarTxId,
            rcptNumber,
          ].filter(Boolean).join(' '),
        },
      });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ── Pending watermark (diagonal, light grey) ──────────────────────────
      if (isPending) {
        doc.save();
        doc
          .fontSize(60)
          .fillColor('#e0e0e0')
          .opacity(0.35)
          .rotate(-45, { origin: [297, 420] })
          .text('PENDING CONFIRMATION', 30, 300, { align: 'center', width: 535 });
        doc.restore();
      }

      // ── Header ──────────────────────────────────────────────────────────
      doc
        .fontSize(22)
        .font('Helvetica-Bold')
        .fillColor('#000000')
        .text('Donation Receipt', { align: 'center' })
        .moveDown(0.5);

      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor('#666666')
        .text('Stellar Micro-Donation Platform', { align: 'center' })
        .fillColor('#000000')
        .moveDown(1.5);

      // ── Divider ──────────────────────────────────────────────────────────
      doc
        .moveTo(50, doc.y)
        .lineTo(545, doc.y)
        .strokeColor('#cccccc')
        .stroke()
        .moveDown(1);

      // ── Fields ───────────────────────────────────────────────────────────
      const field = (label, value) => {
        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .text(`${label}:`, { continued: true })
          .font('Helvetica')
          .text(`  ${value || 'N/A'}`)
          .moveDown(0.4);
      };

      field('Receipt Number', rcptNumber);
      field('Date', new Date(transaction.timestamp).toUTCString());
      field('Confirmation Status', isPending ? 'PENDING CONFIRMATION' : (transaction.status || 'Confirmed'));

      // Amount line — include USD equivalent when available
      const amountLine = usdAmount != null
        ? `${transaction.amount} XLM (≈ $${Number(usdAmount).toFixed(2)} USD)`
        : `${transaction.amount} XLM`;
      field('Amount', amountLine);

      field('Donor Public Key', displayDonor || 'Anonymous');
      field('Recipient Public Key', displayRecipient);
      field('Stellar Transaction Hash', transaction.stellarTxId || 'Pending');

      if (explorerUrl) {
        field('Explorer URL', explorerUrl);
      }

      doc.moveDown(1);

      // ── QR Code ──────────────────────────────────────────────────────────
      if (qrDataUrl) {
        const imgBuffer = Buffer.from(
          qrDataUrl.replace(/^data:image\/png;base64,/, ''),
          'base64'
        );
        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .text('Scan to verify on Stellar Explorer:', { align: 'center' })
          .moveDown(0.5);

        doc.image(imgBuffer, { fit: [120, 120], align: 'center' });
        doc.moveDown(1);
      }

      // ── Footer ───────────────────────────────────────────────────────────
      doc
        .moveTo(50, doc.y)
        .lineTo(545, doc.y)
        .strokeColor('#cccccc')
        .stroke()
        .moveDown(0.5);

      doc
        .fontSize(8)
        .fillColor('#888888')
        .text(
          'This receipt was generated automatically. Please retain for your records.',
          { align: 'center' }
        );

      doc.end();
    });
  }

  /**
   * Send a donation receipt PDF via email.
   *
   * @param {object} params
   * @param {object} params.transaction - Donation transaction record
   * @param {string} params.toEmail - Recipient email address
   * @param {Buffer} [params.pdfBuffer] - Pre-generated PDF; generated if omitted
   * @returns {Promise<{ messageId: string }>}
   */
  static async sendEmail({ transaction, toEmail, pdfBuffer }) {
    if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      throw Object.assign(new Error('Invalid email address'), { status: 400 });
    }

    const pdf = pdfBuffer || (await this.generatePDF(transaction));

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });

    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || 'receipts@stellar-donations.local',
      to: toEmail,
      subject: `Donation Receipt — ${transaction.id}`,
      text: [
        'Thank you for your donation.',
        '',
        `Transaction ID : ${transaction.id}`,
        `Stellar Hash   : ${transaction.stellarTxId || 'N/A'}`,
        `Amount         : ${transaction.amount} XLM`,
        `Date           : ${new Date(transaction.timestamp).toUTCString()}`,
        `Donor          : ${transaction.donor || 'Anonymous'}`,
        `Recipient      : ${transaction.recipient}`,
        '',
        'Please find your PDF receipt attached.',
      ].join('\n'),
      attachments: [
        {
          filename: `receipt-${transaction.id}.pdf`,
          content: pdf,
          contentType: 'application/pdf',
        },
      ],
    });

    log.info('RECEIPT_SERVICE', 'Receipt email sent', {
      messageId: info.messageId,
      to: toEmail,
      transactionId: transaction.id,
    });

    return { messageId: info.messageId };
  }
}

ReceiptService.maskPublicKey = maskPublicKey;

module.exports = ReceiptService;
