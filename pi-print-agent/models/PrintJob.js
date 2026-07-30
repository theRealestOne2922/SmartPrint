import mongoose from 'mongoose';

const printJobSchema = new mongoose.Schema({
    jobId: { type: String, required: true, maxlength: 6 },
    studentName: { type: String, required: true, default: 'Teacher' },
    teacherEmpId: { type: String, default: null },
    fileName: { type: String, required: true },
    filePath: { type: String, required: true },
    pageCount: { type: Number, required: true },
    colorMode: { type: String, required: true, enum: ['bw', 'color'] },
    copies: { type: Number, required: true },
    duplex: { type: Boolean, default: false },
    orientation: { type: String, default: 'portrait', enum: ['portrait', 'landscape'] },
    paperSize: { type: String, default: 'a4', enum: ['a4', 'a3'] },
    pageRange: { type: String, default: 'all' },
    price: { type: Number, required: true },
    status: { type: String, required: true, default: 'uploaded' },
    confidential: { type: Boolean, default: false },
    encrypted: { type: Boolean, default: false },
    // Envelope-encryption metadata written by the backend. These must stay
    // declared here: Mongoose strips schema-undeclared fields when hydrating,
    // so a non-lean read would silently drop them and decryption would fail.
    encIv: { type: String, default: null },
    encAuthTag: { type: String, default: null },
    wrappedKey: { type: String, default: null },
    wrappedKeyIv: { type: String, default: null },
    wrappedKeyAuthTag: { type: String, default: null },
    stripeSessionId: { type: String, default: null },
}, {
    timestamps: true,
    toJSON: {
        virtuals: true,
        transform: (_doc, ret) => {
            ret.id = ret._id;
            delete ret.__v;
            return ret;
        }
    }
});

export const PrintJob = mongoose.model('PrintJob', printJobSchema);
