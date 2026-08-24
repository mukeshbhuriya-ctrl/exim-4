const mongoose = require("mongoose");

const reportTemplateSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    templateName: {
      type: String,
      required: true,
      trim: true,
    },
    mapping: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    /** Ordered columns: [{ seq, type, sourceHeader, customHeader, dataType }] */
    mappingItems: {
      type: [
        {
          seq: { type: Number, min: 1 },
          type: { type: String, trim: true },
          sourceHeader: { type: String, trim: true },
          customHeader: { type: String, trim: true },
          /** Excel cell type: string | number | decimal | date */
          dataType: {
            type: String,
            enum: ["string", "number", "decimal", "date"],
            default: "string",
            trim: true,
          },
        },
      ],
      default: () => [],
    },
  },
  {
    collection: "reporttemplates",
    timestamps: true,
  }
);

reportTemplateSchema.index(
  { companyId: 1, templateName: 1 },
  { unique: true }
);

const ReportTemplate =
  mongoose.models.ReportTemplate ||
  mongoose.model("ReportTemplate", reportTemplateSchema);

module.exports = {
  ReportTemplate,
};
