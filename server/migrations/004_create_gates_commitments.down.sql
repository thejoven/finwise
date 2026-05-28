DROP TRIGGER IF EXISTS trg_commitments_signed_immutable ON commitments;
DROP FUNCTION IF EXISTS enforce_signed_immutability();
DROP TABLE IF EXISTS commitments;
DROP TABLE IF EXISTS gate_evaluations;
