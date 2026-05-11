-- Traductions optionnelles des noms de plats (vide = reprendre `name`, ex. FR)
ALTER TABLE "Dish" ADD COLUMN "nameEn" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Dish" ADD COLUMN "nameNl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Dish" ADD COLUMN "nameEs" TEXT NOT NULL DEFAULT '';
