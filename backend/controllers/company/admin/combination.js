const {
  Combination,
  normalizeCombinationBody,
  sanitizeCombination,
} = require("#utils/combination");

async function getCombination(req, res, next) {
  try {
    const doc = await Combination.findOne({ companyId: req.companyId });

    return res.status(200).json({
      success: true,
      combination: sanitizeCombination(doc),
    });
  } catch (error) {
    return next(error);
  }
}

async function createCombination(req, res, next) {
  try {
    const filter = { companyId: req.companyId };
    const payload = normalizeCombinationBody(req.body);
    const existing = await Combination.findOne(filter);

    const doc = await Combination.findOneAndUpdate(
      filter,
      {
        $set: {
          companyId: req.companyId,
          salesCombination: payload.salesCombination,
          pdfCombination: payload.pdfCombination,
        },
      },
      {
        returnDocument: "after",
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.status(existing ? 200 : 201).json({
      success: true,
      message: existing ? "Combination replaced." : "Combination created.",
      combination: sanitizeCombination(doc),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createCombination,
  getCombination,
};
